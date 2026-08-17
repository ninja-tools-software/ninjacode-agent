import { describe, expect, it } from "vitest";
import {
  compareTrajectories,
  createTrajectory,
  createTrajectoryEvent,
  deserializeTrajectory,
  replayTrajectory,
  serializeTrajectory,
  TrajectoryRecorder,
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
      timeToFirstEditMs: undefined,
      longestLlmTurnMs: undefined,
      readOnlyTurns: 0,
      rereads: 0,
      compactions: 0,
      cacheReadRate: undefined,
      verifications: 0,
      delegations: 0,
    });
  });

  it("captures structural run metrics without retaining event content", () => {
    const recorder = new TrajectoryRecorder({
      sessionId: "session",
      runId: "run",
      traceId: "trace",
      startedAt: 1_000,
    });
    recorder.recordAgentEvent({
      type: "usage",
      payload: {
        turn: 1,
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300 },
      },
    }, 1_050);
    recorder.recordAgentEvent({
      type: "tool_start",
      payload: {
        id: "read-1",
        name: "read_file",
        target: "/private/customer/secret.ts",
        arguments: { path: "/private/customer/secret.ts", apiKey: "sk-super-secret-value" },
      },
    }, 1_100);
    recorder.recordAgentEvent({
      type: "tool_end",
      payload: { id: "read-1", name: "read_file", output: "PRIVATE SOURCE" },
    }, 1_120);
    recorder.recordAgentEvent({
      type: "tool_start",
      payload: {
        id: "read-2",
        name: "read_file",
        target: "/private/customer/secret.ts",
        arguments: { path: "/private/customer/secret.ts" },
      },
    }, 1_130);
    recorder.recordAgentEvent({
      type: "tool_end",
      payload: { id: "read-2", name: "read_file" },
    }, 1_140);
    recorder.recordAgentEvent({
      type: "tool_start",
      payload: {
        id: "edit",
        name: "apply_patch",
        target: "/private/customer/secret.ts",
        arguments: { patch: "PRIVATE PATCH" },
      },
    }, 1_200);
    recorder.recordAgentEvent({
      type: "tool_end",
      payload: { id: "edit", name: "apply_patch" },
    }, 1_250);
    recorder.recordAgentEvent({ type: "compaction", payload: { summary: "PRIVATE SUMMARY" } }, 1_300);
    recorder.recordAgentEvent({
      type: "phase_change",
      payload: {
        from: "explore",
        phase: "execute",
        reason: "workspace_mutated",
        complexity: "complex",
        explorationBudget: 9,
        mutationCount: 1,
        recoveryCycles: 0,
        turn: 2,
      },
    }, 1_310);
    recorder.recordAgentEvent({
      type: "verification_end",
      payload: {
        mode: "adaptive",
        trigger: "non_trivial_mutation",
        localOk: true,
        verifierInvoked: true,
        lgtm: true,
        confidence: 0.9,
        durationMs: 30,
        success: true,
        parentAnswer: "PRIVATE PARENT ANSWER",
      },
    }, 1_320);

    const trajectory = recorder.finalize({ completed: true, estimatedCostUsd: 0.05, endedAt: 1_500 });
    const serialized = serializeTrajectory(trajectory);
    const replay = replayTrajectory(trajectory);

    expect(serialized).not.toContain("customer");
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("sk-super");
    expect(trajectory.events).toContainEqual(
      expect.objectContaining({
        type: "phase",
        attributes: expect.objectContaining({
          from: "explore",
          phase: "execute",
          reason: "workspace_mutated",
        }),
      }),
    );
    expect(trajectory.events).toContainEqual(
      expect.objectContaining({
        type: "verification",
        attributes: expect.objectContaining({
          mode: "adaptive",
          trigger: "non_trivial_mutation",
          verifierInvoked: true,
          lgtm: true,
        }),
      }),
    );
    expect(replay).toMatchObject({
      costUsd: 0.05,
      timeToFirstEditMs: 200,
      readOnlyTurns: 0,
      rereads: 1,
      compactions: 1,
      cacheReadRate: 0.75,
      verifications: 1,
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
