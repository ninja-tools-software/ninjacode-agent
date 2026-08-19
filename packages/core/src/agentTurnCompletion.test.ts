import { describe, expect, it, vi } from "vitest";
import type { Completion, Message } from "@ninjacode/providers";
import {
  appendToolResults,
  evaluateToolLoop,
  handleCompletionWithoutTools,
  recordToolCalls,
} from "./agentTurnCompletion.js";
import type { AgentTurnDeps, AgentTurnMutableState } from "./agentTurnTypes.js";
import { resolveLlmTurnStallOptions } from "./llmTurnGuard.js";

function fingerprintsFor(name: string, args: Record<string, unknown>, times: number): string[] {
  const fingerprints: string[] = [];
  for (let i = 0; i < times; i += 1) {
    recordToolCalls(fingerprints, [{ name, arguments: args }]);
  }
  return fingerprints;
}

describe("evaluateToolLoop", () => {
  it("stays quiet below the warning threshold", () => {
    expect(evaluateToolLoop(fingerprintsFor("read_file", { path: "a.ts" }, 3), true)).toEqual({
      action: "none",
    });
  });

  it("warns at four identical calls", () => {
    const decision = evaluateToolLoop(fingerprintsFor("read_file", { path: "a.ts" }, 4), true);
    expect(decision.action).toBe("warn");
    expect(decision.action === "warn" && decision.message).toContain("read_file");
  });

  it("ends the run at seven, because the warning demonstrably did not land", () => {
    const decision = evaluateToolLoop(fingerprintsFor("read_file", { path: "a.ts" }, 7), true);
    expect(decision.action).toBe("stop");
    expect(decision.action === "stop" && decision.message).toContain("without progress");
  });

  it("only looks at the recent window, so an old streak has expired", () => {
    const stale = fingerprintsFor("read_file", { path: "a.ts" }, 7);
    const recent = Array.from({ length: 12 }, (_, i) => `grep:{"pattern":"p${i}"}`);
    expect(evaluateToolLoop([...stale, ...recent], true)).toEqual({ action: "none" });
  });

  it("treats argument order as irrelevant, so key shuffling cannot hide a loop", () => {
    const fingerprints: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      recordToolCalls(fingerprints, [
        i % 2 === 0
          ? { name: "grep", arguments: { pattern: "x", path: "src" } }
          : { name: "grep", arguments: { path: "src", pattern: "x" } },
      ]);
    }
    expect(evaluateToolLoop(fingerprints, true).action).toBe("stop");
  });

  it("does not conflate different arguments for the same tool", () => {
    const fingerprints: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      recordToolCalls(fingerprints, [{ name: "read_file", arguments: { path: `f${i}.ts` } }]);
    }
    expect(evaluateToolLoop(fingerprints, true)).toEqual({ action: "none" });
  });

  it("is a no-op when detection is disabled", () => {
    expect(evaluateToolLoop(fingerprintsFor("read_file", { path: "a.ts" }, 20), false)).toEqual({
      action: "none",
    });
  });
});

describe("appendToolResults", () => {
  const truncate = (output: string): string => output.slice(0, 20);

  it("keeps each result attached to its call id and tool name", () => {
    const history: Message[] = [];
    appendToolResults(
      history,
      [
        { output: "first", toolCall: { id: "c1", name: "grep", arguments: {} } },
        { output: "second", toolCall: { id: "c2", name: "glob", arguments: {} } },
      ],
      truncate,
    );

    expect(history).toEqual([
      { role: "tool", content: "first", toolCallId: "c1", name: "grep" },
      { role: "tool", content: "second", toolCallId: "c2", name: "glob" },
    ]);
  });

  it("applies the caller's truncation", () => {
    const history: Message[] = [];
    appendToolResults(
      history,
      [{ output: "x".repeat(100), toolCall: { id: "c1", name: "run_shell", arguments: {} } }],
      truncate,
    );
    expect(history[0]!.content).toHaveLength(20);
  });

  it("tells the model how to recover an archived output", () => {
    const history: Message[] = [];
    appendToolResults(
      history,
      [
        {
          output: "trimmed",
          artifactId: "a".repeat(64),
          toolCall: { id: "c1", name: "run_shell", arguments: {} },
        },
      ],
      (output) => output,
    );
    expect(history[0]!.content).toContain("read_session_artifact");
  });

  it("annotates a paged read with the range it covers", () => {
    const history: Message[] = [];
    appendToolResults(
      history,
      [
        {
          output: "body",
          toolCall: { id: "c1", name: "read_file", arguments: { path: "src/a.ts" } },
          meta: { startLine: 10 },
        },
      ],
      (output) => output,
    );
    expect(history[0]!.content).toContain("src/a.ts");
  });
});

function completion(overrides: Partial<Completion> = {}): Completion {
  return {
    text: "done",
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    model: "mock",
    stopReason: "end",
    ...overrides,
  };
}

function completionDeps(overrides: Partial<AgentTurnDeps> = {}): AgentTurnDeps {
  const state: AgentTurnMutableState = {
    history: [],
    turns: [],
    system: "system",
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
    state,
    signal: new AbortController().signal,
    modifiedFiles: new Set<string>(),
    verificationMode: "current",
    enableCompletionVerification: false,
    enableVerificationSubAgent: false,
    llmTurnStall: resolveLlmTurnStallOptions(),
    remainingRunMs: () => Number.POSITIVE_INFINITY,
    runHooks: vi.fn(async () => []),
    emit: vi.fn(async () => {}),
    persist: vi.fn(async () => {}),
    setState: vi.fn(async () => {}),
    recordSessionEvent: vi.fn(async () => {}),
    getCacheStats: () => ({}),
    logAgentEvent: vi.fn(),
    outcome: (answer: string, completed: boolean) => ({
      answer,
      completed,
      stopReason: completed ? "completed" : "incomplete",
      turns: [],
      sessionId: "test",
    }),
    ...overrides,
  } as unknown as AgentTurnDeps;
}

describe("handleCompletionWithoutTools", () => {
  it("retries an empty response twice before failing the run", async () => {
    const deps = completionDeps();

    for (const attempt of [1, 2]) {
      const outcome = await handleCompletionWithoutTools(deps, completion({ text: "  " }));
      expect(outcome).toEqual({ kind: "continue" });
      expect(deps.state.emptyResponseRetries).toBe(attempt);
    }

    const final = await handleCompletionWithoutTools(deps, completion({ text: "" }));
    expect(final).toMatchObject({ kind: "failed" });
    expect(deps.setState).toHaveBeenCalledWith("failed");
  });

  /** Reasoning-only turns are real work: Anthropic thinking now populates this. */
  it("does not treat a reasoning-only turn as empty", async () => {
    const deps = completionDeps();
    const outcome = await handleCompletionWithoutTools(
      deps,
      completion({ text: "", reasoning: "I considered the options" }),
    );
    expect(outcome).toMatchObject({ kind: "done" });
    expect(deps.state.emptyResponseRetries).toBe(0);
  });

  it("asks the model to continue after a max_tokens truncation", async () => {
    const deps = completionDeps();
    const outcome = await handleCompletionWithoutTools(
      deps,
      completion({ text: "partial answer", stopReason: "max_tokens" }),
    );

    expect(outcome).toEqual({ kind: "continue" });
    expect(deps.state.history.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(deps.state.history[1]!.content).toContain("truncated");
    expect(deps.state.turns).toHaveLength(1);
  });

  it("lets a Stop hook block completion up to three times", async () => {
    const deps = completionDeps({
      runHooks: vi.fn(async () => [
        {
          event: "Stop" as const,
          command: "pnpm test",
          ran: true,
          blocked: true,
          stderr: "tests fail",
        },
      ]),
    });

    for (const attempt of [1, 2, 3]) {
      const outcome = await handleCompletionWithoutTools(deps, completion());
      expect(outcome).toEqual({ kind: "continue" });
      expect(deps.state.stopHookRetries).toBe(attempt);
    }

    const final = await handleCompletionWithoutTools(deps, completion());
    expect(final).toMatchObject({ kind: "done" });
  });

  it("skips verification entirely when nothing was modified", async () => {
    const runCompletionVerification = vi.fn();
    const deps = completionDeps({ enableCompletionVerification: true, runCompletionVerification });

    const outcome = await handleCompletionWithoutTools(deps, completion({ text: "all good" }));

    expect(outcome).toEqual({ kind: "done", answer: "all good" });
    expect(runCompletionVerification).not.toHaveBeenCalled();
    expect(deps.setState).toHaveBeenCalledWith("completed");
  });

  it("sends verification failures back as a correction cycle", async () => {
    const deps = completionDeps({
      modifiedFiles: new Set(["src/a.ts"]),
      enableCompletionVerification: true,
      runCompletionVerification: vi.fn(async () => ({
        ok: false,
        ambiguous: false,
        messages: ["typecheck failed"],
        diagnostics: { checked: false, entries: [] },
        commands: [],
      })),
    });

    const outcome = await handleCompletionWithoutTools(deps, completion());

    expect(outcome).toEqual({ kind: "continue" });
    expect(deps.state.verificationRetries).toBe(1);
    expect(deps.state.history.at(-1)!.content).toContain("typecheck failed");
  });

  it("fails after two correction cycles rather than looping on verification", async () => {
    const deps = completionDeps({
      modifiedFiles: new Set(["src/a.ts"]),
      enableCompletionVerification: true,
      runCompletionVerification: vi.fn(async () => ({
        ok: false,
        ambiguous: false,
        messages: ["typecheck failed"],
        diagnostics: { checked: false, entries: [] },
        commands: [],
      })),
    });

    await handleCompletionWithoutTools(deps, completion());
    await handleCompletionWithoutTools(deps, completion());
    const third = await handleCompletionWithoutTools(deps, completion());

    expect(third).toMatchObject({ kind: "failed" });
    expect(deps.setState).toHaveBeenCalledWith("failed");
  });
});
