/**
 * Spawn an isolated sub-agent with its own context window.
 * Supports single task or parallel tasks.
 */
import { randomUUID } from "node:crypto";
import type { LlmProvider } from "@ninjacode/providers";
import type { Tool, ToolRegistry } from "@ninjacode/tools";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import type { AgentFactory } from "./agentFactory.js";
import { defaultPermissionPolicy, PermissionEngine } from "./permissions.js";
import type { AgentEventHandler, AgentMode } from "./types.js";

export type SubAgentRole = "research" | "planner" | "fast_edit" | "verifier" | "custom";

export interface SubAgentResult {
  summary: string;
  completed: boolean;
  task: string;
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

/** Resolve model for a sub-agent role from parent + utility defaults. */
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

export async function runSubAgent(options: {
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
  /** Parent agent's abort signal — aborting the parent aborts this sub-agent too. */
  signal?: AbortSignal;
}): Promise<SubAgentResult> {
  const role = options.role ?? "research";
  const mode = options.mode ?? ROLE_MODES[role];
  let tools = createDefaultToolRegistry({
    includeNetwork: role === "research" || role === "verifier",
    includeDebug: false,
  }).forMode(mode);

  if (options.toolAllowlist?.length) {
    const allow = new Set(options.toolAllowlist);
    tools = tools.filter((t) => allow.has(t.name));
  } else if (role === "research" || role === "verifier") {
    tools = tools.filter((t) => t.risk === "read_only" || t.name === "ask_user");
  }

  const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
  permissions.update({ allowlist: tools.names() });

  const preamble = options.systemPrompt ?? ROLE_PROMPTS[role];

  const agent = options.createAgent({
    provider: options.provider,
    tools: tools as ToolRegistry,
    permissions,
    workspaceRoot: options.workspaceRoot,
    agentDir: options.agentDir,
    mode,
    model: modelForSubAgentRole(role, { model: options.model }),
    utilityModel: "deepseek-v4-flash",
    maxTurns: options.maxTurns ?? (role === "fast_edit" ? 20 : 12),
    sessionId: `sub_${randomUUID()}`,
    onEvent: options.onEvent,
    enableCheckpoints: options.enableCheckpoints ?? false,
    enableCompletionVerification: role === "fast_edit",
    signal: options.signal,
  });

  const outcome = await agent.run(`${preamble}\n\nTask: ${options.task}`);

  return {
    summary: outcome.answer,
    completed: outcome.completed,
    task: options.task,
  };
}

async function runSubAgentsParallel(options: {
  createAgent: AgentFactory;
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  tasks: string[];
  onEvent?: AgentEventHandler;
  role?: SubAgentRole;
  toolAllowlist?: string[];
  model?: string;
  /** Parent agent's abort signal — aborting the parent aborts all sub-agents too. */
  signal?: AbortSignal;
}): Promise<SubAgentResult[]> {
  return Promise.all(
    options.tasks.map((task) =>
      runSubAgent({
        createAgent: options.createAgent,
        provider: options.provider,
        workspaceRoot: options.workspaceRoot,
        agentDir: options.agentDir,
        task,
        onEvent: options.onEvent,
        role: options.role,
        toolAllowlist: options.toolAllowlist,
        model: options.model,
        signal: options.signal,
      }),
    ),
  );
}

async function executeDelegate(
  deps: {
    createAgent: AgentFactory;
    provider: LlmProvider;
    workspaceRoot: string;
    agentDir: string;
    onEvent?: AgentEventHandler;
  },
  ctx: import("@ninjacode/tools").ToolContext,
  args: Record<string, unknown>,
): Promise<{ output: string; meta: Record<string, unknown> }> {
  const tasks = Array.isArray(args.tasks)
    ? (args.tasks as string[]).filter(Boolean)
    : args.task
      ? [String(args.task)]
      : [];
  if (tasks.length === 0) {
    return { output: "Error: provide task or tasks", meta: {} };
  }
  const role = (args.role as SubAgentRole | undefined) ?? "research";
  const results = await runSubAgentsParallel({
    createAgent: deps.createAgent,
    provider: deps.provider,
    workspaceRoot: deps.workspaceRoot,
    agentDir: deps.agentDir,
    tasks,
    onEvent: deps.onEvent,
    role,
    signal: ctx.signal,
  });
  const output = results
    .map((r, i) => `### Sub-agent ${i + 1}: ${r.task}\n${r.summary}`)
    .join("\n\n");
  return {
    output,
    meta: { count: results.length, completed: results.every((r) => r.completed), role },
  };
}

/** Tool wrapper factory registered on parent agent when subagents are enabled. */
export function createDelegateTool(deps: {
  createAgent: AgentFactory;
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  onEvent?: AgentEventHandler;
}): Tool {
  return {
    name: "delegate",
    description:
      "Delegate research/exploration to isolated sub-agent(s). Pass `task` or `tasks` (parallel). " +
      "Optional `role`: research | planner | verifier. Returns summaries only.",
    risk: "read_only",
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
          enum: ["research", "planner", "verifier"],
          description: "Sub-agent specialization",
        },
      },
    },
    target(args: Record<string, unknown>) {
      if (Array.isArray(args.tasks)) return `parallel:${(args.tasks as string[]).length}`;
      return String(args.task ?? "").slice(0, 80);
    },
    async execute(ctx, args) {
      return executeDelegate(deps, ctx, args);
    },
  };
}
