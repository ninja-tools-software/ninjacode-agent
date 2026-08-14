import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, Message, ToolSpec } from "@ninjacode/providers";
import { prepareTurnMessages } from "./agentTurnLlm.js";
import { estimateContextUsage } from "./contextEstimate.js";
import { isCompactionMessage } from "./context.js";
import type { AgentTurnDeps, AgentTurnMutableState } from "./agentTurnTypes.js";

function bigHistory(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
    content: `message number ${i} `.repeat(20),
  }));
}

function countingProvider(): LlmProvider & { completeCalls: number } {
  const provider = {
    name: "mock",
    completeCalls: 0,
    async complete() {
      provider.completeCalls += 1;
      return {
        text: "## Intent\nResume.\n## Files touched\nNone\n## Decisions\nNone\n## Errors\nNone\n## Next steps\nContinue.",
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
    globalTurn: 0,
    toolCallFingerprints: [],
  };
  return {
    turn: 0,
    signal: new AbortController().signal,
    state,
    toolSpecs: [],
    provider,
    maxTokens: 1024,
    maxTurns: 20,
    enablePromptCache: false,
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
    getCacheStats: () => ({}),
    checkRunTimeout: () => undefined,
    logAgentEvent: vi.fn(),
    isAbortError: () => false,
    outcome: (answer: string, completed: boolean) => ({
      answer,
      completed,
      turns: [],
      sessionId: "test",
    }),
  } as unknown as AgentTurnDeps;
}

describe("prepareTurnMessages persists compaction", () => {
  it("writes compacted history so the next turn does not call the utility model again", async () => {
    const provider = countingProvider();
    const deps = depsFor(bigHistory(90), provider);

    await prepareTurnMessages(deps);

    expect(provider.completeCalls).toBe(1);
    expect(deps.state.history.some(isCompactionMessage)).toBe(true);
    expect(deps.state.history.length).toBeLessThan(90);

    deps.state.history.push({ role: "assistant", content: "working" });
    deps.state.history.push({ role: "user", content: "continue" });

    await prepareTurnMessages(deps);

    expect(provider.completeCalls).toBe(1);
    expect(deps.state.history.filter(isCompactionMessage)).toHaveLength(1);
  });
});
