import type { RiskClass, Tool } from "@ninjacode/tools";

export type ApprovalMode = "strict" | "balanced" | "autonomous";

export interface PermissionDecision {
  allowed: boolean;
  needsApproval: boolean;
  reason: string;
}

export interface PermissionPolicy {
  mode: ApprovalMode;
  /** Always auto-approve these tool names. */
  allowlist?: string[];
  /** Always deny these tool names. */
  denylist?: string[];
  /** Session grants after user approval (tool:target). */
  grants?: Set<string>;
}

const DEFAULT_AUTO: Record<ApprovalMode, RiskClass[]> = {
  strict: ["read_only"],
  balanced: ["read_only", "user"],
  autonomous: ["read_only", "write", "user", "network"],
};

/**
 * Deterministic permission engine — guardrails live in the runtime, not the prompt.
 */
export class PermissionEngine {
  constructor(private policy: PermissionPolicy) {}

  update(policy: Partial<PermissionPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  getPolicy(): PermissionPolicy {
    return this.policy;
  }

  /** Grant a specific tool:target pair. Pass target "*" explicitly to grant the whole tool. */
  grant(toolName: string, target: string): void {
    if (!this.policy.grants) this.policy.grants = new Set();
    this.policy.grants.add(`${toolName}:${target}`);
  }

  evaluate(tool: Tool, target: string, scopes?: string[]): PermissionDecision {
    if (this.policy.denylist?.includes(tool.name)) {
      return { allowed: false, needsApproval: false, reason: `Tool ${tool.name} is denylisted` };
    }
    if (this.policy.allowlist?.includes(tool.name)) {
      return { allowed: true, needsApproval: false, reason: "allowlist" };
    }

    const key = `${tool.name}:${target}`;
    const wildcard = `${tool.name}:*`;
    if (this.policy.grants?.has(key) || this.policy.grants?.has(wildcard)) {
      return { allowed: true, needsApproval: false, reason: "session grant" };
    }
    if (scopes && scopes.length > 0 && scopes.every((s) => this.policy.grants?.has(`${tool.name}:${s}`))) {
      return { allowed: true, needsApproval: false, reason: "session grant (command type)" };
    }

    const autoDecision = autoApproveDecision(this.policy.mode, tool.risk);
    if (autoDecision) return autoDecision;

    return {
      allowed: true,
      needsApproval: true,
      reason: `${tool.risk} requires approval in ${this.policy.mode} mode`,
    };
  }
}

function autoApproveDecision(mode: ApprovalMode, risk: RiskClass): PermissionDecision | null {
  const autoRisks = DEFAULT_AUTO[mode];
  if (!autoRisks.includes(risk)) {
    if (risk === "shell" || risk === "destructive") {
      return { allowed: true, needsApproval: true, reason: `${risk} requires approval` };
    }
    return null;
  }
  if (risk === "destructive") {
    return {
      allowed: true,
      needsApproval: true,
      reason: "destructive action requires approval",
    };
  }
  return { allowed: true, needsApproval: false, reason: `auto (${mode}/${risk})` };
}

/**
 * Tools auto-approved regardless of mode: they only ever write agent-internal
 * bookkeeping under `.ninjacode/` (planning scratchpad, todo list), never user
 * files, so gating them behind an approval prompt is pure friction — especially
 * when the user has just asked for a plan.
 */
const DEFAULT_ALLOWLIST = ["write_scratchpad", "todo_write", "write_plan"];

export function defaultPermissionPolicy(mode: ApprovalMode = "balanced"): PermissionPolicy {
  return { mode, grants: new Set(), allowlist: [...DEFAULT_ALLOWLIST] };
}
