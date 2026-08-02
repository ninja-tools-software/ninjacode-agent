import { describe, expect, it } from "vitest";
import {
  appendReasoningDelta,
  appendReasoningToLog,
  normalizeReasoningLog,
} from "./reasoningUi.js";

describe("appendReasoningDelta", () => {
  it("appends tokens on the same line", () => {
    expect(appendReasoningDelta("Hello", " world")).toBe("Hello world");
  });

  it("starts a new line after sentence-ending punctuation", () => {
    expect(appendReasoningDelta("Done.", " Next step")).toBe("Done.\nNext step");
  });

  it("preserves explicit newlines from the model", () => {
    expect(appendReasoningDelta("A", "\n\nB")).toBe("A\n\nB");
  });
});

describe("appendReasoningToLog", () => {
  it("accumulates reasoning on one log entry", () => {
    const log = appendReasoningToLog([], "Let");
    expect(log).toEqual([{ kind: "reasoning", text: "Let" }]);
    expect(appendReasoningToLog(log, " me")).toEqual([{ kind: "reasoning", text: "Let me" }]);
  });

  it("replaces a trailing Thinking status", () => {
    const log = [{ kind: "status", text: "Thinking…" }];
    expect(appendReasoningToLog(log, "Let")).toEqual([{ kind: "reasoning", text: "Let" }]);
  });
});

describe("normalizeReasoningLog", () => {
  it("merges adjacent reasoning blocks", () => {
    const log = [
      { kind: "reasoning", text: "Let" },
      { kind: "reasoning", text: " me" },
      { kind: "status", text: "done" },
    ];
    expect(normalizeReasoningLog(log)).toEqual([
      { kind: "reasoning", text: "Let me" },
      { kind: "status", text: "done" },
    ]);
  });
});
