import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { parseCloudJobV1, type CloudJobV1 } from "./contract.js";
import {
  LeaseLostError,
  type ClaimedJob,
  type DurableJobQueue,
  type FailureDisposition,
  type JobRecord,
} from "./queue.js";

const LOCK_STALE_MS = 30_000;

function timestamp(now: number): string {
  return new Date(now).toISOString();
}

function parseRecord(value: string): JobRecord {
  const raw = JSON.parse(value) as JobRecord;
  return { ...raw, job: parseCloudJobV1(raw.job) };
}

export class FileSystemJobQueue implements DurableJobQueue {
  private readonly recordsDir: string;
  private readonly locksDir: string;

  constructor(root: string) {
    this.recordsDir = path.join(root, "jobs");
    this.locksDir = path.join(root, "locks");
  }

  async enqueue(job: CloudJobV1): Promise<JobRecord> {
    await this.ensureDirectories();
    const parsed = parseCloudJobV1(job);
    const release = await this.acquireLock(parsed.id, true);
    if (!release) throw new Error(`could not lock job ${parsed.id}`);
    try {
      if (await this.readRecord(parsed.id)) throw new Error(`job ${parsed.id} already exists`);
      const now = Date.now();
      const record: JobRecord = {
        job: parsed,
        status: "queued",
        attempt: 0,
        updatedAt: timestamp(now),
        availableAt: now,
      };
      await this.writeRecord(record);
      return record;
    } finally {
      await release();
    }
  }

  async get(jobId: string): Promise<JobRecord | undefined> {
    await this.ensureDirectories();
    return this.readRecord(jobId);
  }

  async claim(workerId: string, now = Date.now()): Promise<ClaimedJob | undefined> {
    await this.ensureDirectories();
    const files = (await readdir(this.recordsDir)).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const jobId = file.slice(0, -5);
      const claimed = await this.tryClaim(jobId, workerId, now);
      if (claimed) return claimed;
    }
    return undefined;
  }

  async markRunning(jobId: string, leaseToken: string, now = Date.now()): Promise<void> {
    await this.mutateLeased(jobId, leaseToken, (record) => ({
      ...record,
      status: "running",
      updatedAt: timestamp(now),
    }));
  }

  async heartbeat(
    jobId: string,
    leaseToken: string,
    leaseMs: number,
    now = Date.now(),
  ): Promise<void> {
    await this.mutateLeased(jobId, leaseToken, (record) => ({
      ...record,
      updatedAt: timestamp(now),
      lease: { ...record.lease!, expiresAt: now + leaseMs },
    }));
  }

  async succeed(
    jobId: string,
    leaseToken: string,
    manifestPath: string,
    now = Date.now(),
  ): Promise<void> {
    await this.mutateLeased(jobId, leaseToken, (record) => ({
      ...record,
      status: "succeeded",
      updatedAt: timestamp(now),
      lease: undefined,
      failure: undefined,
      artifactManifest: manifestPath,
    }));
  }

  async fail(
    jobId: string,
    leaseToken: string,
    disposition: FailureDisposition,
  ): Promise<void> {
    await this.mutateLeased(jobId, leaseToken, (record) => {
      const { failure, retryAt, artifactManifest } = disposition;
      const now = disposition.now ?? Date.now();
      const canRetry = retryAt !== undefined && record.attempt < record.job.execution.maxAttempts;
      return {
        ...record,
        status: canRetry ? "retry_wait" : failure.code === "timeout" ? "timed_out" : "failed",
        updatedAt: timestamp(now),
        availableAt: canRetry ? retryAt : record.availableAt,
        lease: undefined,
        failure,
        artifactManifest,
      };
    });
  }

  private async tryClaim(
    jobId: string,
    workerId: string,
    now: number,
  ): Promise<ClaimedJob | undefined> {
    const release = await this.acquireLock(jobId, false);
    if (!release) return undefined;
    try {
      const record = await this.readRecord(jobId);
      if (!record) return undefined;
      const stale = Boolean(
        (record.status === "leased" || record.status === "running") &&
          record.lease &&
          record.lease.expiresAt <= now,
      );
      if (stale && record.attempt >= record.job.execution.maxAttempts) {
        await this.writeRecord(this.expireRecord(record, now));
        return undefined;
      }
      const ready =
        record.status === "queued" ||
        (record.status === "retry_wait" && record.availableAt <= now) ||
        stale;
      if (!ready) return undefined;
      const lease = {
        token: randomUUID(),
        workerId,
        expiresAt: now + record.job.execution.leaseMs,
      };
      const claimed: JobRecord = {
        ...record,
        status: "leased",
        attempt: record.attempt + 1,
        updatedAt: timestamp(now),
        lease,
        failure: stale
          ? {
              code: "lease_expired",
              message: "previous worker lease expired",
              at: timestamp(now),
            }
          : record.failure,
      };
      await this.writeRecord(claimed);
      return { record: claimed, lease };
    } finally {
      await release();
    }
  }

  private expireRecord(record: JobRecord, now: number): JobRecord {
    return {
      ...record,
      status: "failed",
      updatedAt: timestamp(now),
      lease: undefined,
      failure: {
        code: "lease_expired",
        message: "worker lease expired after final attempt",
        at: timestamp(now),
      },
    };
  }

  private async mutateLeased(
    jobId: string,
    leaseToken: string,
    mutate: (record: JobRecord) => JobRecord,
  ): Promise<void> {
    const release = await this.acquireLock(jobId, true);
    if (!release) throw new Error(`could not lock job ${jobId}`);
    try {
      const record = await this.readRecord(jobId);
      if (!record?.lease || record.lease.token !== leaseToken) throw new LeaseLostError(jobId);
      await this.writeRecord(mutate(record));
    } finally {
      await release();
    }
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.recordsDir, { recursive: true }),
      mkdir(this.locksDir, { recursive: true }),
    ]);
  }

  private recordPath(jobId: string): string {
    return path.join(this.recordsDir, `${jobId}.json`);
  }

  private async readRecord(jobId: string): Promise<JobRecord | undefined> {
    try {
      return parseRecord(await readFile(this.recordPath(jobId), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async writeRecord(record: JobRecord): Promise<void> {
    const target = this.recordPath(record.job.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  }

  private async acquireLock(
    jobId: string,
    wait: boolean,
  ): Promise<(() => Promise<void>) | undefined> {
    const target = path.join(this.locksDir, `${jobId}.lock`);
    const attempts = wait ? 40 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const handle = await this.tryOpenLock(target);
      if (handle) return () => this.releaseLock(handle, target);
      await this.removeStaleLock(target);
      if (wait) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return undefined;
  }

  private async tryOpenLock(target: string): Promise<FileHandle | undefined> {
    try {
      return await open(target, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
      throw error;
    }
  }

  private async removeStaleLock(target: string): Promise<void> {
    try {
      const info = await stat(target);
      if (Date.now() - info.mtimeMs > LOCK_STALE_MS) await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async releaseLock(handle: FileHandle, target: string): Promise<void> {
    await handle.close();
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
