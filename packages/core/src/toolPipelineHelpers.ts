import type { ToolCall } from "@ninjacode/providers";
import type { GrantPolicy, RiskClass, Tool, ToolRegistry } from "@ninjacode/tools";
import type { PermissionEngine } from "./permissions.js";
import type { ApprovalHandler, ApprovalRequest, RunState, ToolInvocation } from "./types.js";

export function abortedInvocation(tc: ToolCall): ToolInvocation {
  return {
    toolCall: tc,
    output: "Aborted by user before this tool call ran.",
    approved: false,
    durationMs: 0,
    error: "aborted",
  };
}

export function safeTarget(tool: Tool, args: Record<string, unknown>): string {
  try {
    return tool.target(args);
  } catch {
    return tool.name;
  }
}

export function safeGrantScopes(tool: Tool, args: Record<string, unknown>): string[] {
  try {
    return tool.grantScopes?.(args) ?? [];
  } catch {
    return [];
  }
}

export function safeGrantPolicy(
  tool: Tool,
  args: Record<string, unknown>,
  scopes: string[],
): GrantPolicy {
  try {
    return tool.grantPolicy?.(args) ?? (scopes.length > 0 ? "scoped" : "exact");
  } catch {
    return "never";
  }
}

/**
 * Risk of this specific call. A tool may escalate on its arguments
 * (`run_shell` does for irreversible commands); a throwing classifier must
 * never downgrade the decision, so failures fall back to the static risk.
 */
function safeRisk(tool: Tool, args: Record<string, unknown>): RiskClass {
  try {
    return tool.riskFor?.(args) ?? tool.risk;
  } catch {
    return tool.risk;
  }
}

const PARALLEL_READ_TOOLS = new Set([
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "search_codebase",
]);
const PATH_READ_TOOLS = new Set(["read_file", "list_dir"]);
const MAX_PARALLEL_READS = 4;

function normalizedReadTarget(tool: Tool, tc: ToolCall): string {
  if (!PATH_READ_TOOLS.has(tc.name)) return `query:${tc.id}`;
  return safeTarget(tool, tc.arguments)
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}

/** Only explicitly audited, read-only calls may overlap. */
export function isParallelizableBatch(registry: ToolRegistry, toolCalls: ToolCall[]): boolean {
  const resources = new Set<string>();
  for (const tc of toolCalls) {
    const tool = registry.get(tc.name);
    if (!tool || tool.risk !== "read_only" || !PARALLEL_READ_TOOLS.has(tc.name)) return false;
    const resource = normalizedReadTarget(tool, tc);
    if (resources.has(resource)) return false;
    resources.add(resource);
  }
  return true;
}

/**
 * Split a model-emitted batch into deterministic execution waves. Consecutive,
 * independent reads/searches overlap; every mutation, shell, prompt and unknown
 * tool is an ordering barrier. Returned call order is always the model's order.
 */
export function toolExecutionBatches(
  registry: ToolRegistry,
  toolCalls: ToolCall[],
  enableParallelReads: boolean,
): ToolCall[][] {
  if (!enableParallelReads) return toolCalls.map((call) => [call]);
  const batches: ToolCall[][] = [];
  let pending: ToolCall[] = [];
  const flush = () => {
    if (pending.length > 0) batches.push(pending);
    pending = [];
  };
  for (const call of toolCalls) {
    const candidate = [...pending, call];
    if (
      candidate.length <= MAX_PARALLEL_READS &&
      isParallelizableBatch(registry, candidate)
    ) {
      pending = candidate;
      continue;
    }
    flush();
    if (isParallelizableBatch(registry, [call])) pending = [call];
    else batches.push([call]);
  }
  flush();
  return batches;
}

interface ApprovalDeps {
  permissions: PermissionEngine;
  onApproval?: ApprovalHandler;
  getState: () => RunState;
  setState: (next: RunState) => Promise<void>;
  waitOrAbort: <T>(promise: Promise<T>) => Promise<T>;
  isAbortError: (error: unknown) => boolean;
  emit: (type: "approval_required", payload: unknown) => Promise<void>;
}

interface ToolApprovalCheck {
  deps: ApprovalDeps;
  tool: Tool;
  tc: ToolCall;
  target: string;
  scopes: string[];
  grantPolicy: GrantPolicy;
  started: number;
}

export async function resolveToolApproval(
  req: ToolApprovalCheck,
): Promise<{ approved: boolean; approvalWaitMs: number; earlyReturn?: ToolInvocation }> {
  const { deps, tool, tc, target, scopes, grantPolicy, started } = req;
  const risk = safeRisk(tool, tc.arguments);
  const decision = deps.permissions.evaluate(tool, target, { scopes, risk, grantPolicy });
  if (!decision.allowed) {
    return deniedInvocation(tc, started, `Denied: ${decision.reason}`);
  }
  if (!decision.needsApproval) {
    return { approved: true, approvalWaitMs: 0 };
  }
  const danger = risk === "destructive";
  return waitForApproval({ deps, tool, tc, target, scopes, grantPolicy, started, decision, danger });
}

function deniedInvocation(
  tc: ToolCall,
  started: number,
  output: string,
  error = "denied",
): { approved: boolean; approvalWaitMs: number; earlyReturn: ToolInvocation } {
  return {
    approved: false,
    approvalWaitMs: 0,
    earlyReturn: { toolCall: tc, output, approved: false, durationMs: Date.now() - started, error },
  };
}

export function rememberGrant(opts: {
  permissions: PermissionEngine;
  toolName: string;
  target: string;
  scopes: string[];
  grantPolicy: GrantPolicy;
  remember?: boolean;
}): void {
  if (!opts.remember || opts.grantPolicy === "never") return;
  if (opts.grantPolicy === "exact" || opts.scopes.length === 0) {
    opts.permissions.grant(opts.toolName, opts.target);
    return;
  }
  for (const s of opts.scopes) opts.permissions.grant(opts.toolName, s);
}

interface PendingApproval {
  deps: ApprovalDeps;
  tool: Tool;
  tc: ToolCall;
  target: string;
  scopes: string[];
  grantPolicy: GrantPolicy;
  started: number;
  decision: { reason: string };
  danger: boolean;
}

function approvalPayload(opts: PendingApproval): ApprovalRequest {
  return {
    toolName: opts.tool.name,
    target: opts.target,
    arguments: opts.tc.arguments,
    reason: opts.decision.reason,
    grantScopes: opts.scopes,
    canRemember: opts.grantPolicy !== "never",
    danger: opts.danger,
  };
}

async function waitForApproval(
  opts: PendingApproval,
): Promise<{ approved: boolean; approvalWaitMs: number; earlyReturn?: ToolInvocation }> {
  const { deps, tool, tc, started, decision } = opts;
  await deps.emit("approval_required", approvalPayload(opts));
  if (!deps.onApproval) {
    return deniedInvocation(
      tc,
      started,
      `Approval required for ${tool.name} (${decision.reason}) but no approval handler is configured.`,
      "approval_required",
    );
  }
  return collectApprovalResult(opts);
}

async function collectApprovalResult(
  opts: PendingApproval,
): Promise<{ approved: boolean; approvalWaitMs: number; earlyReturn?: ToolInvocation }> {
  const { deps, tool, tc, target, scopes, grantPolicy, started } = opts;
  const wasWaiting = deps.getState() !== "stopping" && deps.getState() !== "stopped";
  if (wasWaiting) await deps.setState("waiting");

  const approvalStarted = Date.now();
  try {
    const result = await deps.waitOrAbort(deps.onApproval!(approvalPayload(opts)));
    const approvalWaitMs = Date.now() - approvalStarted;
    if (deps.getState() === "waiting") await deps.setState("running");
    if (!result.approved) {
      return {
        approved: false,
        approvalWaitMs,
        earlyReturn: {
          toolCall: tc,
          output: "User denied this tool call.",
          approved: false,
          durationMs: Date.now() - started - approvalWaitMs,
          approvalWaitMs,
          error: "user_denied",
        },
      };
    }
    rememberGrant({
      permissions: deps.permissions,
      toolName: tool.name,
      target,
      scopes,
      grantPolicy,
      remember: result.remember,
    });
    return { approved: true, approvalWaitMs };
  } catch (e) {
    if (deps.getState() === "waiting") await deps.setState("running");
    if (deps.isAbortError(e)) {
      return {
        approved: false,
        approvalWaitMs: Date.now() - approvalStarted,
        earlyReturn: {
          toolCall: tc,
          output: "Approval wait aborted by user.",
          approved: false,
          durationMs: Date.now() - started,
          approvalWaitMs: Date.now() - approvalStarted,
          error: "aborted",
        },
      };
    }
    throw e;
  }
}

export function preflightToolCall(
  tc: ToolCall,
  registry: ToolRegistry,
  breaker: { isOpen(name: string): boolean },
  started: number,
): ToolInvocation | null {
  if (breaker.isOpen(tc.name)) {
    return {
      toolCall: tc,
      output: `Tool ${tc.name} circuit-open after repeated failures this session.`,
      approved: false,
      durationMs: Date.now() - started,
      error: "circuit_open",
    };
  }

  const tool = registry.get(tc.name);
  if (!tool) {
    return {
      toolCall: tc,
      output: `Unknown tool: ${tc.name}`,
      approved: false,
      durationMs: Date.now() - started,
      error: "unknown_tool",
    };
  }

  return null;
}

export function registryToolOrThrow(registry: ToolRegistry, tc: ToolCall): Tool {
  const tool = registry.get(tc.name);
  if (!tool) throw new Error(`Unknown tool: ${tc.name}`);
  return tool;
}
