import type { ApprovalRequest } from "@ninjacode/core";
import type { CloudJobV1 } from "./contract.js";

export interface ResolvedJobPolicy {
  secrets: readonly string[];
  egress: readonly string[];
}

export interface JobPolicyEnforcer {
  resolve(job: CloudJobV1): ResolvedJobPolicy;
  approve(request: ApprovalRequest): Promise<{ approved: boolean }>;
}

export class PolicyDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyDeniedError";
  }
}

/**
 * The development worker deliberately implements only the safe baseline.
 * Provider transport is worker control-plane traffic; job tools receive no
 * network tools, no secret environment, and no destructive approvals.
 */
export class DenyByDefaultPolicy implements JobPolicyEnforcer {
  resolve(job: CloudJobV1): ResolvedJobPolicy {
    const secrets = job.policy?.secrets ?? [];
    const egress = job.policy?.egress ?? [];
    if (secrets.length > 0) {
      throw new PolicyDeniedError("secret injection is not configured");
    }
    if (egress.length > 0) {
      throw new PolicyDeniedError("egress allowlisting is not configured");
    }
    return { secrets: [], egress: [] };
  }

  async approve(request: ApprovalRequest): Promise<{ approved: boolean }> {
    const networkShell = request.toolName === "run_shell" && request.arguments.network_access === true;
    return { approved: !request.danger && !networkShell };
  }
}
