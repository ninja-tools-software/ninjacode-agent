import type { AgentFactory } from "./agentFactory.js";
import type { AgentEventHandler } from "./types.js";
import type { AgentOptions, ResolvedAgentConfig } from "./agentOptions.js";
import type { ToolRegistry } from "@ninjacode/tools";
import { createDelegateTool } from "./subagents.js";
import type { SubAgentOrchestrator } from "./subagentOrchestrator.js";

export function registerDelegateToolIfNeeded(opts: {
  agentOptions: AgentOptions;
  config: ResolvedAgentConfig;
  tools: ToolRegistry;
  createSubAgent: AgentFactory;
  onEvent?: AgentEventHandler;
  orchestrator: SubAgentOrchestrator;
}): void {
  const { agentOptions, config, tools, createSubAgent, onEvent, orchestrator } = opts;
  if (agentOptions.enableSubagents === false) return;
  if (config.mode !== "agent" && config.mode !== "plan") return;
  if (tools.get("delegate")) return;
  tools.register(
    createDelegateTool({
      createAgent: createSubAgent,
      provider: config.provider,
      workspaceRoot: config.workspaceRoot,
      agentDir: config.agentDir,
      onEvent,
      onApproval: agentOptions.onApproval,
      sandboxMode: config.sandboxMode,
      permissionPolicy: agentOptions.permissions.getPolicy(),
      governance: agentOptions.subagentGovernance,
      orchestrator,
    }),
  );
}
