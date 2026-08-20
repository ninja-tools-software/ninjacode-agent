import { describe, expect, it } from "vitest";
import type { LlmProvider } from "@ninjacode/providers";
import type { AgentOptions } from "./agentOptions.js";
import { resolveAgentConfig } from "./agentOptions.js";

function options(overrides: Partial<AgentOptions> = {}): AgentOptions {
  return {
    provider: { name: "openai" } as LlmProvider,
    tools: {} as AgentOptions["tools"],
    permissions: {} as AgentOptions["permissions"],
    workspaceRoot: "/tmp/ninjacode-profile-test",
    enableRetry: false,
    ...overrides,
  };
}

describe("resolveAgentConfig harness profiles", () => {
  it("uses model profile defaults for reasoning and strict verification", () => {
    const config = resolveAgentConfig(options({ model: "o3", mode: "agent" }));

    expect(config.reasoningEffort).toBe("high");
    expect(config.enableVerificationSubAgent).toBe(true);
  });

  it("keeps explicit caller overrides", () => {
    const config = resolveAgentConfig(options({
      model: "o3",
      reasoningEffort: "low",
      enableVerificationSubAgent: false,
    }));

    expect(config.reasoningEffort).toBe("low");
    expect(config.enableVerificationSubAgent).toBe(false);
  });

  it("does not enable strict verification sub-agents in read-only modes", () => {
    const config = resolveAgentConfig(options({ model: "o3", mode: "ask" }));

    expect(config.enableVerificationSubAgent).toBe(false);
  });

  it("keeps standard orchestration by default and supports an adaptive A/B profile", () => {
    const standard = resolveAgentConfig(options());
    const grok = resolveAgentConfig(options({
      provider: { name: "xai" } as LlmProvider,
      model: "grok-4.6",
    }));
    const adaptive = resolveAgentConfig(options({
      orchestrationProfile: "adaptive",
      adaptiveOrchestration: {
        automaticDelegation: false,
        maxAutomaticDelegations: 2,
        explorationBudgetScale: 1.25,
      },
    }));

    expect(standard.orchestrationProfile).toBe("standard");
    expect(grok.orchestrationProfile).toBe("adaptive");
    expect(grok.reasoningEffort).toBe("high");
    expect(grok.adaptiveOrchestration).toMatchObject({
      automaticDelegation: false,
      maxAutomaticDelegations: 1,
    });
    expect(adaptive).toMatchObject({
      orchestrationProfile: "adaptive",
      adaptiveOrchestration: {
        automaticDelegation: false,
        maxAutomaticDelegations: 2,
        explorationBudgetScale: 1.25,
      },
    });
  });

  it("supports current/blind/adaptive verifier modes with a hard ten-percent budget", () => {
    const current = resolveAgentConfig(options({ budget: { maxCostUsd: 2 } }));
    const blind = resolveAgentConfig(options({
      verificationMode: "blind",
      budget: { maxCostUsd: 2 },
      independentVerifier: {
        maxRunCostRatio: 0.5,
        maxCostUsd: 10,
        maxTurns: 99,
        timeoutMs: 999_999,
      },
    }));
    const adaptiveDisabled = resolveAgentConfig(options({
      verificationMode: "adaptive",
      enableVerificationSubAgent: false,
    }));

    expect(current).toMatchObject({
      verificationMode: "current",
      enableVerificationSubAgent: false,
    });
    expect(blind).toMatchObject({
      verificationMode: "blind",
      enableVerificationSubAgent: true,
      independentVerifier: {
        maxRunCostRatio: 0.1,
        maxCostUsd: 0.2,
        maxTurns: 8,
        timeoutMs: 60_000,
      },
    });
    expect(adaptiveDisabled.enableVerificationSubAgent).toBe(false);
  });

  it("clamps maxTokens so reserved output cannot exhaust the context window", () => {
    const deepseekDefault = resolveAgentConfig(
      options({ maxTokens: 384_000, contextWindow: 200_000 }),
    );
    const deepseekFull = resolveAgentConfig(
      options({ maxTokens: 384_000, contextWindow: 1_000_000 }),
    );
    const claude = resolveAgentConfig(options({ maxTokens: 64_000, contextWindow: 200_000 }));

    expect(deepseekDefault.maxTokens).toBe(157_232);
    expect(deepseekFull.maxTokens).toBe(384_000);
    expect(claude.maxTokens).toBe(64_000);
  });
});
