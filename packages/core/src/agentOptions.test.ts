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

  it("keeps legacy orchestration by default and supports an adaptive A/B profile", () => {
    const legacy = resolveAgentConfig(options());
    const adaptive = resolveAgentConfig(options({
      orchestrationProfile: "adaptive",
      adaptiveOrchestration: {
        automaticDelegation: false,
        maxAutomaticDelegations: 2,
        explorationBudgetScale: 1.25,
      },
    }));

    expect(legacy.orchestrationProfile).toBe("legacy");
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
});
