import { describe, expect, it } from "vitest";
import {
  compareTrajectories,
  createTrajectory,
  createTrajectoryEvent,
  deserializeTrajectory,
  replayTrajectory,
  serializeTrajectory,
} from "./trajectory.js";

describe("trajectory replay", () => {
  it("serializes a versioned, redacted trajectory and replays its metrics", () => {
    const trajectory = createTrajectory({
      traceId: "trace-1",
      runId: "run-1",
      sessionId: "session-1",
      startedAt: 1_000,
      endedAt: 1_600,
      outcome: { correctness: 0.75, completed: true },
      events: [
        createTrajectoryEvent({
          type: "turn",
          timestamp: 1_000,
          costUsd: 0.01,
        }),
        createTrajectoryEvent({
          type: "tool",
          timestamp: 1_200,
          durationMs: 100,
          costUsd: 0.02,
          success: false,
          attributes: { authorization: "Bearer unsafe" },
        }),
        createTrajectoryEvent({
          type: "error",
          timestamp: 1_300,
        }),
      ],
    });

    const serialized = serializeTrajectory(trajectory);
    const restored = deserializeTrajectory(serialized);
    const replay = replayTrajectory(restored);

    expect(restored.schemaVersion).toBe("1.0");
    expect(restored.events[1]?.attributes?.authorization).toBe("[REDACTED]");
    expect(replay).toMatchObject({
      correctness: 0.75,
      costUsd: 0.03,
      latencyMs: 600,
      turnCalls: 1,
      toolCalls: 1,
      subagentCalls: 0,
      errors: 2,
    });
  });

  it("compares candidate correctness, cost, latency, calls and errors", () => {
    const baseline = fixture({
      runId: "baseline",
      correctness: 0.5,
      endedAt: 2_000,
      toolCosts: [0.2, 0.1],
      failedTools: 1,
    });
    const candidate = fixture({
      runId: "candidate",
      correctness: 1,
      endedAt: 1_500,
      toolCosts: [0.1],
      failedTools: 0,
    });

    expect(compareTrajectories(baseline, candidate).delta).toEqual({
      correctness: 0.5,
      costUsd: -0.20000000000000004,
      latencyMs: -500,
      turnCalls: 0,
      toolCalls: -1,
      subagentCalls: 0,
      errors: -1,
    });
  });

  it("rejects unsupported trajectory schema versions", () => {
    const invalid = JSON.stringify({
      schemaVersion: "2.0",
      traceId: "trace",
      runId: "run",
      sessionId: "session",
      events: [],
    });

    expect(() => deserializeTrajectory(invalid)).toThrow("Unsupported trajectory schema version");
  });
});

interface FixtureOptions {
  runId: string;
  correctness: number;
  endedAt: number;
  toolCosts: number[];
  failedTools: number;
}

function fixture(options: FixtureOptions) {
  return createTrajectory({
    traceId: `trace-${options.runId}`,
    runId: options.runId,
    sessionId: "session",
    startedAt: 1_000,
    endedAt: options.endedAt,
    outcome: { correctness: options.correctness, completed: true },
    events: [
      createTrajectoryEvent({ type: "turn", timestamp: 1_000 }),
      ...options.toolCosts.map((costUsd, index) => createTrajectoryEvent({
        type: "tool",
        timestamp: 1_100 + index,
        costUsd,
        success: index >= options.failedTools,
      })),
    ],
  });
}
