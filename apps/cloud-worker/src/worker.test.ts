import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSystemArtifactStore } from "./artifacts.js";
import type { AgentExecutionResult, AgentJobExecutor } from "./executor.js";
import { FileSystemJobQueue } from "./filesystemQueue.js";
import { DenyByDefaultPolicy } from "./policy.js";
import { testJob } from "./testHelpers.js";
import { CloudWorker } from "./worker.js";
import { TempWorkspaceProvisioner } from "./workspace.js";

const roots: string[] = [];

async function setup(executor: AgentJobExecutor, options?: { delayWorkspaceMs?: number }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ninjacode-worker-test-"));
  roots.push(root);
  const queue = new FileSystemJobQueue(path.join(root, "queue"));
  const policy = new DenyByDefaultPolicy();
  const provisioner = new TempWorkspaceProvisioner(path.join(root, "workspaces"));
  const delayWorkspaceMs = options?.delayWorkspaceMs;
  const worker = new CloudWorker({
    workerId: "test-worker",
    queue,
    executor,
    policy,
    workspaces: delayWorkspaceMs
      ? {
          create: async (job) => {
            await new Promise((resolve) => setTimeout(resolve, delayWorkspaceMs));
            return provisioner.create(job);
          },
        }
      : provisioner,
    artifacts: new FileSystemArtifactStore(path.join(root, "artifacts")),
    pollMs: 5,
  });
  return { root, queue, worker };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CloudWorker", () => {
  it("runs an injected agent executor and persists its manifest", async () => {
    const executor: AgentJobExecutor = {
      execute: vi.fn(async ({ workspaceRoot }) => {
        await writeFile(path.join(workspaceRoot, "answer.txt"), "done");
        return {
          completed: true,
          answer: "done",
          turns: 1,
          usage: {
            inputTokens: 3,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsd: 0,
          },
        };
      }),
    };
    const { root, queue, worker } = await setup(executor);
    await queue.enqueue(testJob("success", { artifacts: { paths: ["answer.txt"] } }));

    expect(await worker.runOnce()).toBe(true);
    const record = await queue.get("success");
    expect(record?.status).toBe("succeeded");
    expect(record?.artifactManifest).toBeDefined();
    const manifest = JSON.parse(await readFile(record!.artifactManifest!, "utf8")) as {
      files: Array<{ path: string; sha256: string }>;
    };
    expect(manifest.files[0]?.path).toBe("answer.txt");
    expect(manifest.files[0]?.sha256).toHaveLength(64);
    expect(await readdir(path.join(root, "workspaces"))).toEqual([]);
  });

  it("terminates a timed out attempt with no unbounded retry", async () => {
    const executor: AgentJobExecutor = {
      execute: vi.fn(() => new Promise<AgentExecutionResult>(() => undefined)),
    };
    const { queue, worker } = await setup(executor, { delayWorkspaceMs: 40 });
    const job = testJob("timeout");
    await queue.enqueue({
      ...job,
      execution: {
        ...job.execution,
        maxAttempts: 1,
        leaseMs: 100,
        heartbeatMs: 10,
        timeoutMs: 20,
      },
    });

    await worker.runOnce();
    expect((await queue.get("timeout"))?.status).toBe("timed_out");
  });

  it("rejects secret requests before execution", async () => {
    const execute = vi.fn<AgentJobExecutor["execute"]>();
    const { queue, worker } = await setup({ execute });
    await queue.enqueue(testJob("policy", { policy: { secrets: ["DEPLOY_TOKEN"] } }));

    await worker.runOnce();
    expect(execute).not.toHaveBeenCalled();
    const record = await queue.get("policy");
    expect(record?.status).toBe("failed");
    expect(record?.failure?.code).toBe("policy");
  });
});
