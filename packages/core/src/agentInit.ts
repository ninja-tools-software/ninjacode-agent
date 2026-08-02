import { resolveAgentConfig, type AgentOptions } from "./agentOptions.js";
import { registerDelegateToolIfNeeded } from "./agentDelegate.js";
import type { AgentFactory } from "./agentFactory.js";
import { createAgentConfig, createAgentRuntime, type AgentConfig, type AgentRuntime } from "./agentState.js";

export function initAgent(opts: AgentOptions, createSubAgent: AgentFactory): {
  config: AgentConfig;
  runtime: AgentRuntime;
} {
  const cfg = resolveAgentConfig(opts);
  registerDelegateToolIfNeeded({
    agentOptions: opts,
    config: cfg,
    tools: opts.tools,
    createSubAgent,
    onEvent: opts.onEvent,
  });
  return {
    config: createAgentConfig(opts, cfg),
    runtime: createAgentRuntime(cfg.planId),
  };
}
