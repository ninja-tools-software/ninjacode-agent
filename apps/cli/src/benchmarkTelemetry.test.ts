import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentOutcome } from "@ninjacode/core";
import {
  collectBenchmarkTelemetry,
  telemetryFromStopReason,
  writeBenchmarkTelemetry,
  writeBenchmarkTelemetryStart,
} from "./benchmarkTelemetry.js";

const temporaryDirectories: string[] = [];

function outcome(overrides: Partial<AgentOutcome> = {}): AgentOutcome {
  return {
    answer: "done",
    completed: true,
    stopReason: "completed",
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
    ...overrides,
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
      status: "completed",
      telemetryComplete: true,
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

  it("writes a valid start envelope before the agent can fail", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-telemetry-"));
    temporaryDirectories.push(dir);
    const destination = path.join(dir, "telemetry.json");
    await writeBenchmarkTelemetryStart(
      { provider: "xai", model: "grok-4.6", reasoningEffort: "high" },
      destination,
    );
    const parsed = JSON.parse(await fs.readFile(destination, "utf8")) as {
      status: string;
      telemetryComplete: boolean;
      config: { reasoningEffort: string };
    };
    expect(parsed).toMatchObject({
      status: "started",
      telemetryComplete: false,
      config: { reasoningEffort: "high" },
    });
  });

  it("does nothing without an output path", async () => {
    await expect(writeBenchmarkTelemetry(agent, outcome(), undefined)).resolves.toBe(false);
  });

  it("maps timeout, abort, and incomplete outcomes onto Harbor failure kinds", () => {
    expect(telemetryFromStopReason("timeout")).toEqual({
      status: "agent_timeout",
      failureKind: "agent_timeout",
    });
    expect(telemetryFromStopReason("aborted")).toEqual({
      status: "aborted",
      failureKind: "agent_exit",
    });
    expect(telemetryFromStopReason("incomplete")).toEqual({
      status: "agent_exit",
      failureKind: "agent_exit",
    });
    expect(
      collectBenchmarkTelemetry(
        agent,
        outcome({ completed: false, stopReason: "timeout", answer: "Run timeout exceeded (840s)." }),
      ),
    ).toMatchObject({
      status: "agent_timeout",
      failureKind: "agent_timeout",
      stopReason: "timeout",
      telemetryComplete: true,
      completed: false,
    });
  });
});
