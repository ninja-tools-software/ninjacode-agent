import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAgentRun } from "./agentLifecycle.js";
import type { CheckpointFailure } from "./types.js";

const temporaryDirs: string[] = [];

async function agentDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-lifecycle-"));
  temporaryDirs.push(root);
  return path.join(root, ".ninjacode");
}

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("prepareAgentRun", () => {
  it("reports a typed init failure and lets the run continue", async () => {
    const failures: CheckpointFailure[] = [];
    const result = await prepareAgentRun({
      agentDir: await agentDir(),
      enableCheckpoints: true,
      checkpoints: {
        init: async () => {
          throw new Error("git unavailable");
        },
        create: async () => ({ id: "unused" }),
      },
      requestsLength: 2,
      sessionId: "session",
      task: { text: "keep running" },
      emitCheckpoint: async () => undefined,
      emitCheckpointFailure: async (failure) => {
        failures.push(failure);
      },
    });

    expect(result).toEqual({ requestSeq: 3 });
    expect(failures).toEqual([{ stage: "init", message: "git unavailable" }]);
  });

  it("reports checkpoint creation failures without rejecting", async () => {
    const failures: CheckpointFailure[] = [];
    const result = await prepareAgentRun({
      agentDir: await agentDir(),
      enableCheckpoints: true,
      checkpoints: {
        init: async () => undefined,
        create: async () => {
          throw new Error("commit failed");
        },
      },
      requestsLength: 0,
      sessionId: "session",
      task: { text: "keep running" },
      emitCheckpoint: async () => undefined,
      emitCheckpointFailure: async (failure) => {
        failures.push(failure);
      },
    });

    expect(result).toEqual({ requestSeq: 1 });
    expect(failures).toEqual([{ stage: "create", message: "commit failed" }]);
  });

  it("keeps a created checkpoint when host notification fails", async () => {
    const failures: CheckpointFailure[] = [];
    const result = await prepareAgentRun({
      agentDir: await agentDir(),
      enableCheckpoints: true,
      checkpoints: {
        init: async () => undefined,
        create: async () => ({ id: "checkpoint-1" }),
      },
      requestsLength: 0,
      sessionId: "session",
      task: { text: "edit a file" },
      emitCheckpoint: async () => {
        throw new Error("host disconnected");
      },
      emitCheckpointFailure: async (failure) => {
        failures.push(failure);
      },
    });

    expect(result).toEqual({ requestSeq: 1, pendingCheckpointId: "checkpoint-1" });
    expect(failures).toEqual([{ stage: "emit", message: "host disconnected" }]);
  });
});
