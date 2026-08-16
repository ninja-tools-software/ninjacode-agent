import { resolveAgentConfig, type AgentOptions } from "./agentOptions.js";
import { registerDelegateToolIfNeeded } from "./agentDelegate.js";
import type { AgentFactory } from "./agentFactory.js";
import { createAgentConfig, createAgentRuntime, type AgentConfig, type AgentRuntime } from "./agentState.js";
import { SubAgentOrchestrator } from "./subagentOrchestrator.js";

export function initAgent(opts: AgentOptions, createSubAgent: AgentFactory): {
  config: AgentConfig;
  runtime: AgentRuntime;
} {
  const cfg = resolveAgentConfig(opts);
  const subagentOrchestrator = new SubAgentOrchestrator(cfg.subagentGovernance);
  registerDelegateToolIfNeeded({
    agentOptions: opts,
    config: cfg,
    tools: opts.tools,
    createSubAgent,
    onEvent: opts.onEvent,
    orchestrator: subagentOrchestrator,
  });
  return {
    config: createAgentConfig(opts, cfg, subagentOrchestrator),
    runtime: createAgentRuntime(cfg.planId),
  };
}
