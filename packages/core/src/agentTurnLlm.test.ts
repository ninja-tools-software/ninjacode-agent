import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, Message, ToolSpec } from "@ninjacode/providers";
import { LlmError } from "@ninjacode/providers";
import {
  activeFilesForContext,
  callLlmForTurn,
  ContextBudgetError,
  prepareTurnMessages,
} from "./agentTurnLlm.js";
import { estimateContextUsage } from "./contextEstimate.js";
import { isCompactionMessage } from "./context.js";
import type { AgentTurnDeps, AgentTurnMutableState } from "./agentTurnTypes.js";
import { withRetry } from "./reliability.js";
import { resolveLlmTurnStallOptions } from "./llmTurnGuard.js";

function bigHistory(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
    content: `message number ${i} `.repeat(20),
  }));
}

function countingProvider(): LlmProvider & { completeCalls: number; requestedModels: Array<string | undefined> } {
  const provider = {
    name: "mock",
    completeCalls: 0,
    requestedModels: [] as Array<string | undefined>,
    async complete(request: Parameters<LlmProvider["complete"]>[0]) {
      provider.completeCalls += 1;
      provider.requestedModels.push(request.model);
      return {
        text: "## Task\nResume.\n## Constraints\nNone\n## Files touched\nNone\n## Decisions\nNone\n## Validation\nNone\n## Open work\nContinue.\n## Archives\nNone",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 20 },
        model: "mock",
        stopReason: "end" as const,
      };
    },
    async completeStreaming() {
      throw new Error("execution LLM should not be called from prepareTurnMessages");
    },
  };
  return provider;
}

function depsFor(history: Message[], provider: LlmProvider): AgentTurnDeps {
  const state: AgentTurnMutableState = {
    history,
    turns: [],
    system: "You are NinjaCode.",
    volatileContext: { scratchpad: "", plan: "" },
    emptyResponseRetries: 0,
    stopHookRetries: 0,
    verificationRetries: 0,
    llmStallRetries: 0,
    recentLlmTurnMs: [],
    firedClockMarks: [],
    globalTurn: 0,
    toolCallFingerprints: [],
  };
  return {
    turn: 0,
    signal: new AbortController().signal,
    state,
    toolSpecs: [],
    provider,
    model: "primary-model",
    utilityModel: "utility-model",
    maxTokens: 1024,
    maxTurns: 20,
    enablePromptCache: false,
    minimalVolatileContext: true,
    enableLoopDetection: false,
    enableCompletionVerification: false,
    enableVerificationSubAgent: false,
    modifiedFiles: new Set(),
    estimateUsage: (system: string, hist: Message[], toolSpecs: ToolSpec[]) =>
      estimateContextUsage({ system, history: hist, tools: toolSpecs }),
    emit: vi.fn(async () => {}),
    persist: vi.fn(async () => {}),
    setState: vi.fn(async () => {}),
    trackUsage: vi.fn(),
    archiveCompaction: vi.fn(async () => undefined),
    getCacheStats: () => ({}),
    checkRunTimeout: () => undefined,
    remainingRunMs: () => Number.POSITIVE_INFINITY,
    llmTurnStall: resolveLlmTurnStallOptions(),
    logAgentEvent: vi.fn(),
    isAbortError: () => false,
    outcome: (answer: string, completed: boolean) => ({
      answer,
      completed,
      stopReason: completed ? "completed" : "incomplete",
      turns: [],
      sessionId: "test",
    }),
  } as unknown as AgentTurnDeps;
}

describe("activeFilesForContext", () => {
  it("combines first-turn mentions, host files, git/IDE context, and touched paths", async () => {
    const deps = depsFor(
      [{ role: "user", content: "Update @src/mentioned.ts and `src/quoted.ts:12`." }],
      countingProvider(),
    );
    deps.workspaceRoot = "/workspace";
    deps.modifiedFiles.add("src/modified.ts");
    deps.activeFilesProvider = async () => ["src/open-tab.ts", "src/git-diff.ts"];

    await expect(activeFilesForContext(deps)).resolves.toEqual(
      expect.arrayContaining([
        "src/mentioned.ts",
        "src/quoted.ts",
        "src/modified.ts",
        "src/open-tab.ts",
        "src/git-diff.ts",
      ]),
    );
  });

  it("injects a mentioned file's scoped rule on the first turn", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-first-turn-rules-"));
    try {
      await fs.mkdir(path.join(root, ".ninjacode", "rules"), { recursive: true });
      await fs.writeFile(
        path.join(root, ".ninjacode", "rules", "typescript.md"),
        '---\nglobs: ["**/*.ts"]\n---\nFIRST_TURN_TYPESCRIPT_RULE',
      );
      const deps = depsFor(
        [{ role: "user", content: "Please update @src/mentioned.ts." }],
        countingProvider(),
      );
      deps.workspaceRoot = root;

      const messages = await prepareTurnMessages(deps);
      expect(messages.map((message) => message.content).join("\n")).toContain(
        "FIRST_TURN_TYPESCRIPT_RULE",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("prepareTurnMessages persists compaction", () => {
  it("writes compacted history so the next turn does not call the utility model again", async () => {
    const provider = countingProvider();
    const deps = depsFor(bigHistory(90), provider);

    await prepareTurnMessages(deps);

    expect(provider.completeCalls).toBe(1);
    expect(provider.requestedModels).toEqual(["utility-model"]);
    expect(deps.state.history.some(isCompactionMessage)).toBe(true);
    expect(deps.state.history.length).toBeLessThan(90);

    deps.state.history.push({ role: "assistant", content: "working" });
    deps.state.history.push({ role: "user", content: "continue" });

    await prepareTurnMessages(deps);

    expect(provider.completeCalls).toBe(1);
    expect(deps.state.history.filter(isCompactionMessage)).toHaveLength(1);
  });

  it("throws and emits a structured context budget error", async () => {
    const deps = depsFor([], countingProvider());
    deps.estimateUsage = () => ({
      output: 20,
      total: 110,
      window: 120,
      inputBudget: 100,
      safetyMargin: 10,
      system: 1,
      tools: 0,
      history: 89,
      files: 0,
      images: 0,
    });

    await expect(prepareTurnMessages(deps)).rejects.toBeInstanceOf(ContextBudgetError);
    expect(deps.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({
        code: "context_budget_exceeded",
        retryable: false,
        recoveryHint: expect.any(String),
      }),
    );
  });

  it("injects scoped rules for files read in earlier turns", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nc-turn-rules-")));
    try {
      const rulesDir = path.join(root, ".ninjacode", "rules");
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(
        path.join(rulesDir, "typescript.md"),
        `---\nglobs: ["**/*.ts"]\n---\nUse strict TypeScript.`,
      );
      const deps = depsFor([{ role: "user", content: "Continue" }], countingProvider());
      deps.workspaceRoot = root;
      deps.state.turns.push({
        turn: 0,
        assistantText: "",
        toolInvocations: [{
          toolCall: { id: "read-1", name: "read_file", arguments: { path: "src/app.ts" } },
          output: "file contents",
          approved: true,
          durationMs: 1,
        }],
        usage: { inputTokens: 1, outputTokens: 1 },
      });

      const messages = await prepareTurnMessages(deps);

      expect(messages.map((message) => message.content).join("\n")).toContain(
        "Use strict TypeScript.",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function executionProvider(
  run: (
    attempt: number,
    sink: Parameters<LlmProvider["completeStreaming"]>[1],
  ) => ReturnType<LlmProvider["completeStreaming"]>,
): LlmProvider & { attempts: number } {
  const provider = {
    name: "execution",
    attempts: 0,
    async complete() {
      throw new Error("unused");
    },
    async completeStreaming(
      _request: Parameters<LlmProvider["completeStreaming"]>[0],
      sink?: Parameters<LlmProvider["completeStreaming"]>[1],
    ) {
      provider.attempts += 1;
      return run(provider.attempts, sink);
    },
  };
  return provider;
}

/** Never answers; only the harness guard can end the call. */
function stallingProvider(): LlmProvider & { attempts: number } {
  const provider = {
    name: "stalling",
    attempts: 0,
    async complete() {
      throw new Error("unused");
    },
    async completeStreaming(request: Parameters<LlmProvider["completeStreaming"]>[0]) {
      provider.attempts += 1;
      return new Promise<never>((_resolve, reject) => {
        request.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
  };
  return provider;
}

const successCompletion = {
  text: "ok",
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1 },
  model: "mock",
  stopReason: "end" as const,
};

describe("callLlmForTurn safe retry", () => {
  it("retries one raw transient failure before any stream event", async () => {
    const provider = executionProvider(async (attempt) => {
      if (attempt === 1) throw new LlmError("temporary", 503, "test");
      return successCompletion;
    });
    const deps = depsFor([], provider);

    const result = await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(result).toEqual({ completion: successCompletion });
    expect(provider.attempts).toBe(2);
  });

  it("does not retry after any stream event reached the harness", async () => {
    const provider = executionProvider(async (_attempt, sink) => {
      await sink?.({ type: "text_delta", text: "partial" });
      throw new LlmError("temporary", 503, "test");
    });
    const deps = depsFor([], provider);

    const result = await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(result).toMatchObject({ kind: "failed" });
    expect(provider.attempts).toBe(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ retryable: false, code: "llm_error" }),
    );
  });

  it("does not stack a turn retry over the provider retry wrapper", async () => {
    const raw = executionProvider(async () => {
      throw new LlmError("temporary", 503, "test");
    });
    const provider = withRetry(raw, { maxRetries: 0, sleep: async () => undefined });
    const deps = depsFor([], provider);

    const result = await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(result).toMatchObject({ kind: "failed" });
    expect(raw.attempts).toBe(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ retryable: false }),
    );
  });

  it("marks a fully exhausted raw turn retry as non-retryable", async () => {
    const provider = executionProvider(async () => {
      throw new LlmError("temporary", 503, "test");
    });
    const deps = depsFor([], provider);

    const result = await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(result).toMatchObject({ kind: "failed" });
    expect(provider.attempts).toBe(2);
    expect(deps.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ code: "retry_exhausted", retryable: false }),
    );
  });
});

describe("callLlmForTurn stall guard", () => {
  function stallingDeps(maxConsecutiveStalls: number) {
    const provider = stallingProvider();
    const deps = depsFor([], provider);
    deps.llmTurnStall = { requestTimeoutMs: 20, streamIdleTimeoutMs: 0, maxConsecutiveStalls };
    return { deps, provider };
  }

  it("retries a stalled turn once instead of burning the run budget", async () => {
    const { deps, provider } = stallingDeps(2);

    const result = await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(result).toEqual({ kind: "continue" });
    expect(deps.state.llmStallRetries).toBe(1);
    expect(provider.attempts).toBe(1);
    expect(deps.setState).not.toHaveBeenCalled();
    expect(deps.state.history).toEqual([]);
  });

  it("ends the run once stalls are consecutive", async () => {
    const { deps } = stallingDeps(2);

    await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);
    const result = await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(result).toMatchObject({ kind: "failed" });
    expect(deps.setState).toHaveBeenCalledWith("failed");
    expect(deps.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ code: "llm_turn_stalled", retryable: false }),
    );
  });

  it("stops immediately when no retry is budgeted", async () => {
    const { deps } = stallingDeps(1);

    const result = await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(result).toMatchObject({ kind: "failed" });
  });

  // Without this the wall clock a stall consumed is invisible: the trajectory
  // just skips a turn number and the lost minutes cannot be attributed.
  it("reports the wall clock a retried stall consumed", async () => {
    const { deps } = stallingDeps(2);

    await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    const [, payload] = vi
      .mocked(deps.emit)
      .mock.calls.find(([type]) => type === "error") as [string, Record<string, unknown>];
    expect(payload).toMatchObject({
      code: "llm_turn_stalled",
      category: "llm_stall_request",
      retryable: true,
    });
    expect(payload.durationMs).toBeGreaterThanOrEqual(20);
  });

  it("forgets earlier stalls after a turn that answered", async () => {
    const { deps } = stallingDeps(2);
    await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);
    expect(deps.state.llmStallRetries).toBe(1);

    deps.provider = executionProvider(async () => successCompletion);
    await callLlmForTurn(deps, [{ role: "system", content: "system" }], []);

    expect(deps.state.llmStallRetries).toBe(0);
  });

  it("reports a user stop as stopped, never as a stall", async () => {
    const controller = new AbortController();
    const provider = stallingProvider();
    const deps = depsFor([], provider);
    deps.signal = controller.signal;
    deps.isAbortError = (error) => error instanceof DOMException && error.name === "AbortError";
    deps.llmTurnStall = { requestTimeoutMs: 5_000, streamIdleTimeoutMs: 0, maxConsecutiveStalls: 2 };

    const pending = callLlmForTurn(deps, [{ role: "system", content: "system" }], []);
    controller.abort(new DOMException("User stopped", "AbortError"));

    await expect(pending).resolves.toMatchObject({ kind: "stopped" });
    expect(deps.state.llmStallRetries).toBe(0);
    expect(deps.setState).toHaveBeenCalledWith("stopped");
  });
});
