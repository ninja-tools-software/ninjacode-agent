import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemJobQueue } from "./filesystemQueue.js";
import { testJob } from "./testHelpers.js";

const roots: string[] = [];

async function queue(): Promise<FileSystemJobQueue> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ninjacode-queue-test-"));
  roots.push(root);
  return new FileSystemJobQueue(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileSystemJobQueue", () => {
  it("claims a job only once across concurrent workers", async () => {
    const jobs = await queue();
    await jobs.enqueue(testJob());
    const claims = await Promise.all([
      jobs.claim("worker-a", 1_000),
      jobs.claim("worker-b", 1_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await jobs.get("job-1"))?.status).toBe("leased");
  });

  it("makes failed attempts available after the bounded delay", async () => {
    const jobs = await queue();
    await jobs.enqueue(testJob());
    const claim = await jobs.claim("worker-a", 1_000);
    expect(claim).toBeDefined();
    await jobs.fail("job-1", claim!.lease.token, {
      failure: {
        code: "execution",
        message: "transient",
        at: new Date(2_000).toISOString(),
      },
      retryAt: 3_000,
      now: 2_000,
    });
    expect(await jobs.claim("worker-b", 2_999)).toBeUndefined();
    expect((await jobs.claim("worker-b", 3_000))?.record.attempt).toBe(2);
  });

  it("recovers an expired lease after a worker crash", async () => {
    const jobs = await queue();
    await jobs.enqueue(testJob());
    const first = await jobs.claim("worker-a", 1_000);
    expect(first?.lease.expiresAt).toBe(11_000);
    const recovered = await jobs.claim("worker-b", 11_000);
    expect(recovered?.record.attempt).toBe(2);
    expect(recovered?.record.failure?.code).toBe("lease_expired");
    expect(recovered?.lease.workerId).toBe("worker-b");
  });
});
