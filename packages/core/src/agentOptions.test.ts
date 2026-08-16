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
});
