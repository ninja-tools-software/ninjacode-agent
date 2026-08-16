import type { ArtifactStore } from "./artifacts.js";
import type { AgentJobExecutor } from "./executor.js";
import { PolicyDeniedError, type JobPolicyEnforcer } from "./policy.js";
import type { ClaimedJob, DurableJobQueue, JobFailure } from "./queue.js";
import type { EphemeralWorkspace, WorkspaceProvisioner } from "./workspace.js";

class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`job timed out after ${timeoutMs}ms`);
    this.name = "JobTimeoutError";
  }
}

export interface CloudWorkerOptions {
  workerId: string;
  queue: DurableJobQueue;
  workspaces: WorkspaceProvisioner;
  executor: AgentJobExecutor;
  artifacts: ArtifactStore;
  policy: JobPolicyEnforcer;
  pollMs?: number;
}

function retryAt(claimed: ClaimedJob, now: number): number {
  const retry = claimed.record.job.execution.retry;
  const exponential = retry.baseDelayMs * 2 ** Math.max(0, claimed.record.attempt - 1);
  return now + Math.min(exponential, retry.maxDelayMs);
}

function failureFor(error: unknown, now: number): JobFailure {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof JobTimeoutError
      ? "timeout"
      : error instanceof PolicyDeniedError
        ? "policy"
        : "execution";
  return { code, message: message.slice(0, 4_000), at: new Date(now).toISOString() };
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export class CloudWorker {
  constructor(private readonly options: CloudWorkerOptions) {}

  async runOnce(): Promise<boolean> {
    const claimed = await this.options.queue.claim(this.options.workerId);
    if (!claimed) return false;
    await this.process(claimed);
    return true;
  }

  async runLoop(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const worked = await this.runOnce();
      if (!worked) await wait(this.options.pollMs ?? 1_000, signal);
    }
  }

  private async process(claimed: ClaimedJob): Promise<void> {
    const { job } = claimed.record;
    const controller = new AbortController();
    let workspace: EphemeralWorkspace | undefined;
    let manifestPath: string | undefined;
    let timedOut = false;
    let rejectTimeout: (error: Error) => void = () => undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const heartbeat = setInterval(() => {
      void this.options.queue
        .heartbeat(job.id, claimed.lease.token, job.execution.leaseMs)
        .catch((error: unknown) => controller.abort(error));
    }, job.execution.heartbeatMs);
    const timeout = setTimeout(() => {
      timedOut = true;
      const error = new JobTimeoutError(job.execution.timeoutMs);
      controller.abort(error);
      rejectTimeout(error);
    }, job.execution.timeoutMs);

    try {
      const policy = this.options.policy.resolve(job);
      await this.options.queue.markRunning(job.id, claimed.lease.token);
      workspace = await this.options.workspaces.create(job);
      const result = await Promise.race([
        this.options.executor.execute({
          job,
          attempt: claimed.record.attempt,
          workspaceRoot: workspace.root,
          policy,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      const persisted = await this.options.artifacts.persist({
        job,
        attempt: claimed.record.attempt,
        workspaceRoot: workspace.root,
        policy,
        result,
      });
      manifestPath = persisted.manifestPath;
      if (!result.completed) throw new Error(result.answer || "agent did not complete");
      await this.options.queue.succeed(job.id, claimed.lease.token, manifestPath);
    } catch (error) {
      const effectiveError = timedOut ? new JobTimeoutError(job.execution.timeoutMs) : error;
      const now = Date.now();
      const failure = failureFor(effectiveError, now);
      await this.options.queue.fail(job.id, claimed.lease.token, {
        failure,
        retryAt: failure.code === "policy" ? undefined : retryAt(claimed, now),
        artifactManifest: manifestPath,
        now,
      });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      controller.abort();
      await workspace?.destroy().catch(() => undefined);
    }
  }
}
