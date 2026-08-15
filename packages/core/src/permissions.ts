import type { GrantPolicy, RiskClass, Tool } from "@ninjacode/tools";

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

export interface PermissionCall {
  scopes?: string[];
  risk?: RiskClass;
  grantPolicy?: GrantPolicy;
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

  /**
   * `risk` overrides `tool.risk` for calls whose danger depends on their
   * arguments (see `Tool.riskFor`); callers resolve it with `safeRisk`.
   */
  evaluate(
    tool: Tool,
    target: string,
    call: PermissionCall = {},
  ): PermissionDecision {
    const scopes = call.scopes;
    const risk = call.risk ?? tool.risk;
    const grantPolicy = call.grantPolicy ?? (scopes?.length ? "scoped" : "exact");
    if (this.policy.denylist?.includes(tool.name)) {
      return { allowed: false, needsApproval: false, reason: `Tool ${tool.name} is denylisted` };
    }
    // The allowlist pre-approves a tool, not an irreversible call made with it:
    // a host that wants those through says so in its approval handler.
    if (risk !== "destructive" && this.policy.allowlist?.includes(tool.name)) {
      return { allowed: true, needsApproval: false, reason: "allowlist" };
    }

    const granted = this.grantDecision(tool.name, target, {
      scopes,
      risk,
      grantPolicy,
    });
    if (granted) return granted;

    const autoDecision = autoApproveDecision(this.policy.mode, risk);
    if (autoDecision) {
      if (autoDecision.needsApproval && grantPolicy === "never") {
        return { ...autoDecision, reason: `${autoDecision.reason}; dynamic call cannot be remembered` };
      }
      return autoDecision;
    }

    return {
      allowed: true,
      needsApproval: true,
      reason:
        grantPolicy === "never"
          ? `${risk} requires per-call approval in ${this.policy.mode} mode`
          : `${risk} requires approval in ${this.policy.mode} mode`,
    };
  }

  private grantDecision(
    toolName: string,
    target: string,
    call: Required<Pick<PermissionCall, "risk" | "grantPolicy">> &
      Pick<PermissionCall, "scopes">,
  ): PermissionDecision | null {
    const { scopes, risk, grantPolicy } = call;
    if (grantPolicy === "never") return null;
    const grants = this.policy.grants;
    if (!grants) return null;
    if (grants.has(`${toolName}:${target}`)) {
      return { allowed: true, needsApproval: false, reason: "session grant" };
    }
    // A destructive call is never covered by a grant given for something
    // coarser than itself: "always allow git" was answered about `git status`,
    // not about `git push --force`. Only an exact match, above, carries over.
    if (risk === "destructive") return null;
    if (grants.has(`${toolName}:*`)) {
      return { allowed: true, needsApproval: false, reason: "session grant" };
    }
    if (scopes && scopes.length > 0 && scopes.every((s) => grants.has(`${toolName}:${s}`))) {
      return { allowed: true, needsApproval: false, reason: "session grant (command type)" };
    }
    return null;
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
