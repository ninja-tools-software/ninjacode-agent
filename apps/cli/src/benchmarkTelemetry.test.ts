import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentOutcome } from "@ninjacode/core";
import { collectBenchmarkTelemetry, writeBenchmarkTelemetry } from "./benchmarkTelemetry.js";

const temporaryDirectories: string[] = [];

function outcome(): AgentOutcome {
  return {
    answer: "done",
    completed: true,
    sessionId: "session-1",
    turns: [
      {
        turn: 0,
        assistantText: "",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolInvocations: [
          { toolCall: { id: "1", name: "read_file", arguments: {} } },
          { toolCall: { id: "2", name: "run_shell", arguments: {} }, error: "failed" },
        ] as never,
      },
    ],
  };
}

const agent = {
  getCacheStats: () => ({
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 200,
    cacheWriteTokens: 25,
    estimatedCostUsd: 0.0123,
  }),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

describe("benchmark telemetry", () => {
  it("collects Harbor-compatible token and tool metrics", () => {
    expect(collectBenchmarkTelemetry(agent, outcome())).toMatchObject({
      schemaVersion: 1,
      completed: true,
      inputTokens: 100,
      cacheReadTokens: 200,
      toolCalls: 2,
      toolErrors: 1,
      toolHistogram: { read_file: 1, run_shell: 1 },
    });
  });

  it("writes telemetry atomically when a destination is requested", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-telemetry-"));
    temporaryDirectories.push(dir);
    const destination = path.join(dir, "nested", "telemetry.json");
    await writeBenchmarkTelemetry(agent, outcome(), destination);
    const parsed = JSON.parse(await fs.readFile(destination, "utf8")) as { sessionId: string };
    expect(parsed.sessionId).toBe("session-1");
  });

  it("does nothing without an output path", async () => {
    await expect(writeBenchmarkTelemetry(agent, outcome(), undefined)).resolves.toBeUndefined();
  });
});
