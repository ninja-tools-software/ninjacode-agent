import { describe, expect, it } from "vitest";
import {
  configureLearningMetrics,
  recordLearningFeedback,
} from "./learningMetrics.js";
import { createTelemetryContext } from "./telemetry.js";

describe("learning metrics", () => {
  it("collects nothing by default", () => {
    const recorded: unknown[] = [];
    configureLearningMetrics({
      enabled: false,
      sink: { record: (feedback) => { recorded.push(feedback); } },
    });

    expect(recordLearningFeedback({ decision: "keep", satisfaction: 5 })).toBe(false);
    expect(recorded).toEqual([]);
  });

  it("records keep, rollback and satisfaction only through an opt-in sink", () => {
    const recorded: unknown[] = [];
    const context = createTelemetryContext({
      scope: "turn",
      scopeId: "turn-1",
      identifiers: { runId: "run-1", sessionId: "session-1" },
    });
    configureLearningMetrics({
      enabled: true,
      sink: { record: (feedback) => { recorded.push(feedback); } },
    });

    expect(recordLearningFeedback({
      decision: "rollback",
      satisfaction: 2,
      context,
      timestamp: 1_000,
    })).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      decision: "rollback",
      satisfaction: 2,
      timestamp: 1_000,
      traceId: context.traceId,
      runId: "run-1",
      sessionId: "session-1",
      turnId: "turn-1",
    });
    configureLearningMetrics({ enabled: false });
  });

  it("rejects satisfaction outside the explicit one-to-five scale", () => {
    configureLearningMetrics({
      enabled: true,
      sink: { record: () => undefined },
    });

    expect(() => recordLearningFeedback({ decision: "keep", satisfaction: 0 }))
      .toThrow("between 1 and 5");
    configureLearningMetrics({ enabled: false });
  });
});
