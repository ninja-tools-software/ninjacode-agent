import type { LlmProvider } from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";
import type { SandboxMode } from "@ninjacode/tools";
import type { PermissionEngine } from "./permissions.js";
import type { SessionBudget } from "./reliability.js";
import type {
  AgentEventHandler,
  AgentMode,
  AgentOutcome,
  ApprovalHandler,
} from "./types.js";

/** Options for spawning an isolated sub-agent via {@link AgentFactory}. */
export interface SubAgentSpawnOptions {
  provider: LlmProvider;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  model?: string;
  utilityModel?: string;
  maxTurns: number;
  sessionId: string;
  onEvent?: AgentEventHandler;
  onApproval?: ApprovalHandler;
  enableCheckpoints: boolean;
  enableCompletionVerification: boolean;
  enableSubagents: false;
  sandboxMode: SandboxMode;
  runTimeoutMs: number;
  budget: SessionBudget;
  signal?: AbortSignal;
}

export type AgentFactory = (options: SubAgentSpawnOptions) => {
  run(task: string): Promise<
    Pick<AgentOutcome, "answer" | "completed"> &
      Partial<Pick<AgentOutcome, "turns" | "sessionId">>
  >;
};
