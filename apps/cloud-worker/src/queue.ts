import type { CloudJobV1 } from "./contract.js";

export type JobStatus =
  | "queued"
  | "leased"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "timed_out"
  | "failed";

export interface JobFailure {
  code: "execution" | "lease_expired" | "policy" | "timeout";
  message: string;
  at: string;
}

export interface JobLease {
  token: string;
  workerId: string;
  expiresAt: number;
}

export interface JobRecord {
  job: CloudJobV1;
  status: JobStatus;
  attempt: number;
  updatedAt: string;
  availableAt: number;
  lease?: JobLease;
  failure?: JobFailure;
  artifactManifest?: string;
}

export interface ClaimedJob {
  record: JobRecord;
  lease: JobLease;
}

export interface FailureDisposition {
  failure: JobFailure;
  retryAt?: number;
  artifactManifest?: string;
  now?: number;
}

export interface DurableJobQueue {
  enqueue(job: CloudJobV1): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | undefined>;
  claim(workerId: string, now?: number): Promise<ClaimedJob | undefined>;
  markRunning(jobId: string, leaseToken: string, now?: number): Promise<void>;
  heartbeat(jobId: string, leaseToken: string, leaseMs: number, now?: number): Promise<void>;
  succeed(jobId: string, leaseToken: string, manifestPath: string, now?: number): Promise<void>;
  fail(jobId: string, leaseToken: string, disposition: FailureDisposition): Promise<void>;
}

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`lease lost for job ${jobId}`);
    this.name = "LeaseLostError";
  }
}
