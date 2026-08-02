import type { LlmProvider } from "@ninjacode/providers";
import { createDefaultToolRegistry, type ToolRegistry } from "@ninjacode/tools";
import { Agent, type AgentOptions } from "./agent.js";
import {
  PermissionEngine,
  defaultPermissionPolicy,
  type ApprovalMode,
} from "./permissions.js";

export interface BuildAgentRuntimeOptions {
  workspaceRoot: string;
  provider: LlmProvider;
  approvalMode?: ApprovalMode;
  /** Pre-approve every tool in the registry (after configureTools). */
  allowAllTools?: boolean;
  /** Persistent grants applied after the permission engine is created. */
  grants?: ReadonlyArray<{ tool: string; target: string }>;
  includeNetwork?: boolean;
  includeDebug?: boolean;
  /** Register MCP or other tools before the allowlist is computed. */
  configureTools?: (tools: ToolRegistry) => void | Promise<void>;
  /** Remaining AgentOptions minus the wired core. */
  agent?: Omit<AgentOptions, "provider" | "tools" | "permissions" | "workspaceRoot">;
}

export interface AgentRuntime {
  tools: ToolRegistry;
  permissions: PermissionEngine;
  agentOptions: AgentOptions;
  createAgent(overrides?: Partial<AgentOptions>): Agent;
}

/** Shared wiring: default tools, permission policy, and AgentOptions assembly. */
export async function buildAgentRuntime(
  options: BuildAgentRuntimeOptions,
): Promise<AgentRuntime> {
  const tools = createDefaultToolRegistry({
    includeNetwork: options.includeNetwork,
    includeDebug: options.includeDebug,
  });

  if (options.configureTools) {
    await options.configureTools(tools);
  }

  const permissions = new PermissionEngine(
    defaultPermissionPolicy(options.approvalMode ?? "balanced"),
  );

  if (options.allowAllTools) {
    permissions.update({ allowlist: tools.names() });
  }

  for (const { tool, target } of options.grants ?? []) {
    permissions.grant(tool, target);
  }

  const agentOptions: AgentOptions = {
    provider: options.provider,
    tools,
    permissions,
    workspaceRoot: options.workspaceRoot,
    ...options.agent,
  };

  return {
    tools,
    permissions,
    agentOptions,
    createAgent(overrides) {
      return new Agent({ ...agentOptions, ...overrides });
    },
  };
}
