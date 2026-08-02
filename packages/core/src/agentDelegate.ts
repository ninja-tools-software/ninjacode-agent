import type { AgentFactory } from "./agentFactory.js";
import type { AgentEventHandler } from "./types.js";
import type { AgentOptions, ResolvedAgentConfig } from "./agentOptions.js";
import type { ToolRegistry } from "@ninjacode/tools";
import { createDelegateTool } from "./subagents.js";

export function registerDelegateToolIfNeeded(opts: {
  agentOptions: AgentOptions;
  config: ResolvedAgentConfig;
  tools: ToolRegistry;
  createSubAgent: AgentFactory;
  onEvent?: AgentEventHandler;
}): void {
  const { agentOptions, config, tools, createSubAgent, onEvent } = opts;
  if (agentOptions.enableSubagents === false || config.mode !== "agent") return;
  if (tools.get("delegate")) return;
  tools.register(
    createDelegateTool({
      createAgent: createSubAgent,
      provider: config.provider,
      workspaceRoot: config.workspaceRoot,
      agentDir: config.agentDir,
      onEvent,
    }),
  );
}
