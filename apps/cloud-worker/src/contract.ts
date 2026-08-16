export const CLOUD_JOB_VERSION = 1 as const;

export interface CloudJobV1 {
  version: typeof CLOUD_JOB_VERSION;
  id: string;
  createdAt: string;
  task: {
    prompt: string;
    model?: string;
    maxTurns?: number;
  };
  workspace: {
    kind: "empty";
  };
  execution: {
    maxAttempts: number;
    leaseMs: number;
    heartbeatMs: number;
    timeoutMs: number;
    retry: {
      baseDelayMs: number;
      maxDelayMs: number;
    };
  };
  policy?: {
    secrets?: string[];
    egress?: string[];
  };
  artifacts?: {
    paths?: string[];
  };
}

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, name: string, max: number): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function stringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function parseTask(value: unknown): CloudJobV1["task"] {
  const task = object(value, "task");
  if (typeof task.prompt !== "string" || task.prompt.trim().length === 0) {
    throw new Error("task.prompt must be a non-empty string");
  }
  if (task.model !== undefined && typeof task.model !== "string") {
    throw new Error("task.model must be a string");
  }
  return {
    prompt: task.prompt,
    model: task.model,
    maxTurns:
      task.maxTurns === undefined
        ? undefined
        : positiveInteger(task.maxTurns, "task.maxTurns", 256),
  };
}

function parseExecution(value: unknown): CloudJobV1["execution"] {
  const execution = object(value, "execution");
  const retry = object(execution.retry, "execution.retry");
  const parsed = {
    maxAttempts: positiveInteger(execution.maxAttempts, "execution.maxAttempts", 10),
    leaseMs: positiveInteger(execution.leaseMs, "execution.leaseMs", 86_400_000),
    heartbeatMs: positiveInteger(execution.heartbeatMs, "execution.heartbeatMs", 3_600_000),
    timeoutMs: positiveInteger(execution.timeoutMs, "execution.timeoutMs", 86_400_000),
    retry: {
      baseDelayMs: positiveInteger(retry.baseDelayMs, "execution.retry.baseDelayMs", 3_600_000),
      maxDelayMs: positiveInteger(retry.maxDelayMs, "execution.retry.maxDelayMs", 86_400_000),
    },
  };
  if (parsed.heartbeatMs >= parsed.leaseMs) {
    throw new Error("execution.heartbeatMs must be shorter than execution.leaseMs");
  }
  if (parsed.retry.baseDelayMs > parsed.retry.maxDelayMs) {
    throw new Error("execution.retry.baseDelayMs must not exceed maxDelayMs");
  }
  return parsed;
}

export function parseCloudJobV1(value: unknown): CloudJobV1 {
  const job = object(value, "job");
  if (job.version !== CLOUD_JOB_VERSION) throw new Error("unsupported job version");
  if (typeof job.id !== "string" || !JOB_ID.test(job.id)) throw new Error("invalid job id");
  if (typeof job.createdAt !== "string" || Number.isNaN(Date.parse(job.createdAt))) {
    throw new Error("createdAt must be an ISO date");
  }
  const workspace = object(job.workspace, "workspace");
  if (workspace.kind !== "empty") throw new Error("unsupported workspace kind");
  const policy = job.policy === undefined ? undefined : object(job.policy, "policy");
  const artifacts = job.artifacts === undefined ? undefined : object(job.artifacts, "artifacts");
  return {
    version: CLOUD_JOB_VERSION,
    id: job.id,
    createdAt: job.createdAt,
    task: parseTask(job.task),
    workspace: { kind: "empty" },
    execution: parseExecution(job.execution),
    policy: policy
      ? {
          secrets: stringArray(policy.secrets, "policy.secrets"),
          egress: stringArray(policy.egress, "policy.egress"),
        }
      : undefined,
    artifacts: artifacts
      ? { paths: stringArray(artifacts.paths, "artifacts.paths") }
      : undefined,
  };
}
