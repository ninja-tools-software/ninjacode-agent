import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import {
  buildVolatileContextDelta,
  buildVolatileContextMessage,
  isVolatileContextMessage,
  stubSupersededVolatileContext,
  volatileContextChanged,
} from "./volatileContext.js";

describe("buildVolatileContextMessage", () => {
  it("costs nothing when there is no scratchpad or plan", () => {
    expect(buildVolatileContextMessage({ scratchpad: "", plan: "  \n " })).toBeNull();
  });

  it("carries scratchpad and plan as a user message", () => {
    const message = buildVolatileContextMessage({ scratchpad: "note A", plan: "step 1" });
    expect(message?.role).toBe("user");
    expect(message?.content).toContain("note A");
    expect(message?.content).toContain("step 1");
  });

  it("marks itself as superseding earlier snapshots", () => {
    const message = buildVolatileContextMessage({ scratchpad: "note", plan: "" });
    expect(message && isVolatileContextMessage(message)).toBe(true);
  });

  it("caps each section so a pasted file cannot flood the context", () => {
    const message = buildVolatileContextMessage({ scratchpad: "x".repeat(10_000), plan: "" });
    expect(message?.content.length).toBeLessThan(4_500);
    expect(message?.content).toContain("[truncated]");
  });
});

describe("buildVolatileContextDelta", () => {
  it("emits only changed sections and represents clears", () => {
    const changed = buildVolatileContextDelta(
      { scratchpad: "same", plan: "old plan" },
      { scratchpad: "same", plan: "new plan" },
    );
    expect(changed?.content).not.toContain("scratchpad");
    expect(changed?.content).toContain("new plan");

    const cleared = buildVolatileContextDelta(
      { scratchpad: "note", plan: "plan" },
      { scratchpad: "", plan: "plan" },
    );
    expect(cleared?.content).toContain("(cleared)");
    expect(cleared && isVolatileContextMessage(cleared)).toBe(true);
  });
});

describe("volatileContextChanged", () => {
  it("is false for an identical snapshot", () => {
    const snapshot = { scratchpad: "a", plan: "b" };
    expect(volatileContextChanged(snapshot, { ...snapshot })).toBe(false);
  });

  it("is true when either section moved", () => {
    expect(volatileContextChanged({ scratchpad: "a", plan: "b" }, { scratchpad: "a2", plan: "b" })).toBe(true);
    expect(volatileContextChanged({ scratchpad: "a", plan: "b" }, { scratchpad: "a", plan: "b2" })).toBe(true);
  });
});

describe("stubSupersededVolatileContext", () => {
  it("keeps the latest snapshot and shrinks the earlier ones in place", () => {
    const history: Message[] = [
      buildVolatileContextMessage({ scratchpad: "old note", plan: "" })!,
      { role: "assistant", content: "working" },
      buildVolatileContextMessage({ scratchpad: "new note", plan: "" })!,
    ];

    const result = stubSupersededVolatileContext(history);

    expect(result).toHaveLength(3);
    expect(result[0]?.content).not.toContain("old note");
    expect(result[0]?.content).toContain("Superseded");
    expect(result[1]?.content).toBe("working");
    expect(result[2]?.content).toContain("new note");
  });

  it("leaves a history without snapshots untouched", () => {
    const history: Message[] = [{ role: "user", content: "hi" }];
    expect(stubSupersededVolatileContext(history)).toBe(history);
  });
});
