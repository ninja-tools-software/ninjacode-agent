import { describe, expect, it } from "vitest";
import {
  abortReasonMessage,
  classifyAgentStopReason,
  isTimeoutAbortReason,
} from "./agentRuntime.js";

describe("agent stop classification", () => {
  it("keeps TimeoutError distinct from a user abort", () => {
    const timeout = new DOMException("Run timeout exceeded (840s).", "TimeoutError");
    expect(isTimeoutAbortReason(timeout)).toBe(true);
    expect(isTimeoutAbortReason(new DOMException("Aborted by user", "AbortError"))).toBe(false);
    expect(
      classifyAgentStopReason({
        completed: false,
        aborted: true,
        abortReason: timeout,
      }),
    ).toBe("timeout");
    expect(
      classifyAgentStopReason({
        completed: false,
        aborted: true,
        abortReason: new DOMException("Aborted by user", "AbortError"),
      }),
    ).toBe("aborted");
    expect(
      classifyAgentStopReason({
        completed: false,
        aborted: false,
        answer: "Max turns reached without completing the task.",
      }),
    ).toBe("incomplete");
  });

  it("propagates the abort signal reason instead of a generic user abort", () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Run timeout exceeded (1s).", "TimeoutError"));
    expect(abortReasonMessage(controller.signal)).toBe("Run timeout exceeded (1s).");
  });
});
