import { randomUUID } from "node:crypto";
import type { LlmProvider } from "@ninjacode/providers";
import type { SandboxMode, Tool, ToolRegistry } from "@ninjacode/tools";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import type { AgentFactory } from "./agentFactory.js";
import type { SubAgentGovernanceOptions } from "./agentOptions.js";
import { defaultPermissionPolicy, PermissionEngine } from "./permissions.js";
import type { PermissionPolicy } from "./permissions.js";
import {
  SubAgentOrchestrator,
  type ResolvedSubAgentGovernance,
} from "./subagentOrchestrator.js";
import type {
  AgentEvent,
  AgentEventHandler,
  AgentMode,
  ApprovalHandler,
  TurnTrace,
} from "./types.js";

export {
  DEFAULT_SUBAGENT_GOVERNANCE,
  resolveSubAgentGovernance,
  SubAgentOrchestrator,
} from "./subagentOrchestrator.js";
export type { ResolvedSubAgentGovernance } from "./subagentOrchestrator.js";

export type SubAgentRole = "research" | "planner" | "fast_edit" | "verifier" | "custom";

export interface SubAgentEvidence {
  tool: string;
  output: string;
}

export interface SubAgentArtifact {
  id: string;
  tool: string;
}

export interface SubAgentTestResult {
  command: string;
  passed: boolean;
  output: string;
}

export interface SubAgentResult {
  summary: string;
  completed: boolean;
  task: string;
  evidence: SubAgentEvidence[];
  artifacts: SubAgentArtifact[];
  changedFiles: string[];
  tests: SubAgentTestResult[];
}

const ROLE_PROMPTS: Record<SubAgentRole, string> = {
  research:
    "You are a read-only research sub-agent. Investigate and return a concise factual summary.",
  planner:
    "You are a planning sub-agent. Explore the codebase read-only and return a structured plan with steps and risks.",
  fast_edit:
    "You are a fast-edit sub-agent. Make minimal targeted edits to complete the scoped task, then verify with read_lints or tests.",
  verifier:
    "You are a verification sub-agent. Review changes adversarially for bugs, regressions, and missing tests. Be concise.",
  custom: "You are a specialized sub-agent. Complete the scoped task and return a concise summary.",
};

const ROLE_MODES: Record<SubAgentRole, AgentMode> = {
  research: "ask",
  planner: "plan",
  fast_edit: "agent",
  verifier: "ask",
  custom: "ask",
};

/** Preferred model tier for internal sub-agents (economy = cheapest capable). */
export type SubAgentModelTier = "economy" | "standard" | "inherit";

export const ROLE_MODEL_TIER: Record<SubAgentRole, SubAgentModelTier> = {
  research: "economy",
  planner: "standard",
  fast_edit: "standard",
  verifier: "economy",
  custom: "inherit",
};

export function modelForSubAgentRole(
  role: SubAgentRole,
  opts?: { model?: string; utilityModel?: string; parentModel?: string },
): string | undefined {
  if (opts?.model) return opts.model;
  const tier = ROLE_MODEL_TIER[role];
  if (tier === "inherit") return opts?.parentModel;
  if (tier === "economy") return opts?.utilityModel ?? "deepseek-v4-flash";
  return opts?.parentModel ?? opts?.utilityModel;
}

export interface RunSubAgentOptions {
  createAgent: AgentFactory;
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  task: string;
  onEvent?: AgentEventHandler;
  maxTurns?: number;
  model?: string;
  role?: SubAgentRole;
  mode?: AgentMode;
  toolAllowlist?: string[];
  systemPrompt?: string;
  enableCheckpoints?: boolean;
  maxCostUsd?: number;
  timeoutMs?: number;
  sandboxMode?: SandboxMode;
  permissionPolicy?: PermissionPolicy;
  onApproval?: ApprovalHandler;
  governance?: SubAgentGovernanceOptions;
  orchestrator?: SubAgentOrchestrator;
  signal?: AbortSignal;
}

function clonePermissionPolicy(policy?: PermissionPolicy): PermissionPolicy {
  const source = policy ?? defaultPermissionPolicy("balanced");
  return {
    ...source,
    allowlist: source.allowlist ? [...source.allowlist] : undefined,
    denylist: source.denylist ? [...source.denylist] : undefined,
    grants: new Set(source.grants ?? []),
  };
}

function toolsForChild(options: RunSubAgentOptions, role: SubAgentRole, mode: AgentMode): ToolRegistry {
  let tools = createDefaultToolRegistry({
    includeNetwork: role === "research" || role === "verifier",
    includeDebug: false,
  }).forMode(mode);
  if (options.toolAllowlist?.length) {
    const allow = new Set(options.toolAllowlist);
    tools = tools.filter((tool) => allow.has(tool.name));
  } else if (role === "research" || role === "verifier") {
    tools = tools.filter((tool) => tool.risk === "read_only" || tool.name === "ask_user");
  }
  return tools;
}

function collectResult(
  task: string,
  outcome: { answer: string; completed: boolean; turns?: TurnTrace[] },
): SubAgentResult {
  const invocations = (outcome.turns ?? []).flatMap((turn) => turn.toolInvocations);
  const evidence = invocations
    .filter((invocation) => !invocation.error)
    .map((invocation) => ({
      tool: invocation.toolCall.name,
      output: invocation.output.slice(0, 1000),
    }));
  const artifacts = invocations.flatMap((invocation) =>
    invocation.artifactId ? [{ id: invocation.artifactId, tool: invocation.toolCall.name }] : [],
  );
  const changedFiles = new Set<string>();
  for (const invocation of invocations) {
    if (!["write_file", "edit_file", "apply_patch", "delete_file"].includes(invocation.toolCall.name)) {
      continue;
    }
    if (typeof invocation.meta?.path === "string") changedFiles.add(invocation.meta.path);
    if (Array.isArray(invocation.meta?.paths)) {
      for (const file of invocation.meta.paths) if (typeof file === "string") changedFiles.add(file);
    }
  }
  const tests = invocations.filter(isTestInvocation).map((invocation) => ({
    command:
      invocation.toolCall.name === "read_lints"
        ? "read_lints"
        : String(invocation.toolCall.arguments.command ?? "run_shell"),
    passed: !invocation.error,
    output: invocation.output.slice(0, 2000),
  }));
  return {
    summary: outcome.answer,
    completed: outcome.completed,
    task,
    evidence,
    artifacts,
    changedFiles: [...changedFiles],
    tests,
  };
}

function isTestInvocation(invocation: TurnTrace["toolInvocations"][number]): boolean {
  if (invocation.toolCall.name === "read_lints") return true;
  if (invocation.toolCall.name !== "run_shell") return false;
  const command = String(invocation.toolCall.arguments.command ?? "");
  return /\b(test|typecheck|lint|vitest|jest|pytest|cargo test|go test)\b/i.test(command);
}

async function runChild(
  options: RunSubAgentOptions,
  role: SubAgentRole,
  governance: ResolvedSubAgentGovernance,
): Promise<SubAgentResult> {
  const mode = options.mode ?? ROLE_MODES[role];
  const tools = toolsForChild(options, role, mode);
  const permissions = new PermissionEngine(clonePermissionPolicy(options.permissionPolicy));
  const preamble = options.systemPrompt ?? ROLE_PROMPTS[role];
  const childId = `sub_${randomUUID()}`;
  const startedAt = Date.now();
  await options.onEvent?.({
    type: "subagent_start",
    payload: { id: childId, role, task: options.task },
  });
  try {
    const agent = options.createAgent({
      provider: options.provider,
      tools,
      permissions,
      workspaceRoot: options.workspaceRoot,
      agentDir: options.agentDir,
      mode,
      model: modelForSubAgentRole(role, { model: options.model }),
      utilityModel: "deepseek-v4-flash",
      maxTurns: options.maxTurns ?? governance.maxTurns,
      sessionId: childId,
      onEvent: async (event: AgentEvent) => {
        await options.onEvent?.({
          type: "subagent_progress",
          payload: { id: childId, role, task: options.task, event },
        });
        await options.onEvent?.(event);
      },
      onApproval: options.onApproval,
      enableCheckpoints: options.enableCheckpoints ?? false,
      enableCompletionVerification: role === "fast_edit",
      enableSubagents: false,
      sandboxMode: role === "fast_edit" ? (options.sandboxMode ?? "read-only") : "read-only",
      runTimeoutMs: options.timeoutMs ?? governance.timeoutMs,
      budget: { maxCostUsd: options.maxCostUsd ?? governance.maxCostUsd },
      signal: options.signal,
    });
    const outcome = await agent.run(`${preamble}\n\nTask: ${options.task}`);
    const result = collectResult(options.task, outcome);
    await options.onEvent?.({
      type: "subagent_end",
      payload: { id: childId, role, durationMs: Date.now() - startedAt, result },
    });
    return result;
  } catch (error) {
    await options.onEvent?.({
      type: "subagent_end",
      payload: {
        id: childId,
        role,
        durationMs: Date.now() - startedAt,
        aborted: options.signal?.aborted === true,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function runSubAgent(options: RunSubAgentOptions): Promise<SubAgentResult> {
  const role = options.role ?? "research";
  const orchestrator = options.orchestrator ?? new SubAgentOrchestrator(options.governance);
  return orchestrator.run(role === "fast_edit", options.signal, () =>
    runChild(options, role, orchestrator.governance),
  );
}

export async function runSubAgents(options: Omit<RunSubAgentOptions, "task"> & {
  tasks: string[];
}): Promise<SubAgentResult[]> {
  const orchestrator = options.orchestrator ?? new SubAgentOrchestrator(options.governance);
  return Promise.all(
    options.tasks.map((task) =>
      runSubAgent({
        ...options,
        task,
        orchestrator,
      }),
    ),
  );
}

interface DelegateDependencies {
  createAgent: AgentFactory;
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  onEvent?: AgentEventHandler;
  onApproval?: ApprovalHandler;
  sandboxMode?: SandboxMode;
  permissionPolicy?: PermissionPolicy;
  governance?: SubAgentGovernanceOptions;
  orchestrator?: SubAgentOrchestrator;
}

async function executeDelegate(
  deps: DelegateDependencies,
  ctx: import("@ninjacode/tools").ToolContext,
  args: Record<string, unknown>,
): Promise<{ output: string; meta: Record<string, unknown> }> {
  const tasks = Array.isArray(args.tasks)
    ? args.tasks.filter((task): task is string => typeof task === "string" && Boolean(task.trim()))
    : args.task
      ? [String(args.task)]
      : [];
  if (tasks.length === 0) {
    return { output: "Error: provide task or tasks", meta: {} };
  }
  const role = (args.role as SubAgentRole | undefined) ?? "research";
  const results = await runSubAgents({
    ...deps,
    tasks,
    role,
    signal: ctx.signal,
  });
  const output = JSON.stringify({ results }, null, 2);
  return {
    output,
    meta: {
      count: results.length,
      completed: results.every((result) => result.completed),
      role,
      results,
    },
  };
}

export function createDelegateTool(deps: DelegateDependencies): Tool {
  const orchestrator = deps.orchestrator ?? new SubAgentOrchestrator(deps.governance);
  return {
    name: "delegate",
    description:
      "Delegate scoped work to governed isolated sub-agent(s). Pass `task` or `tasks`. " +
      "Optional `role`: research | planner | fast_edit | verifier. Returns structured results.",
    risk: "read_only",
    riskFor(args) {
      return args.role === "fast_edit" ? "write" : "read_only";
    },
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Single research task" },
        tasks: {
          type: "array",
          items: { type: "string" },
          description: "Parallel research tasks (preferred for multi-area exploration)",
        },
        role: {
          type: "string",
          enum: ["research", "planner", "fast_edit", "verifier"],
          description: "Sub-agent specialization",
        },
      },
    },
    target(args: Record<string, unknown>) {
      if (Array.isArray(args.tasks)) return `parallel:${(args.tasks as string[]).length}`;
      return String(args.task ?? "").slice(0, 80);
    },
    async execute(ctx, args) {
      return executeDelegate({ ...deps, orchestrator }, ctx, args);
    },
  };
}
