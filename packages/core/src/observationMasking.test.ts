import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import {
  hasRecoverableArtifact,
  isMaskableObservation,
  maskOldObservations,
} from "./observationMasking.js";

function observation(name: string, index: number, size = 2000): Message {
  return {
    role: "tool",
    name,
    toolCallId: `call_${index}`,
    content: `${name}-${index}-${"x".repeat(size)}`,
  };
}

function observations(name: string, count: number): Message[] {
  return Array.from({ length: count }, (_, i) => observation(name, i));
}

function archivedObservations(name: string, count: number): Message[] {
  return observations(name, count).map((message, index) => ({
    ...message,
    content: `${message.content}\n[Full output archived as artifact ${String(index).padStart(64, "a")}.]`,
  }));
}

describe("isMaskableObservation", () => {
  it("accepts re-runnable read-only tools", () => {
    for (const name of ["read_file", "grep", "glob", "list_dir"]) {
      expect(isMaskableObservation(observation(name, 0))).toBe(true);
    }
  });

  it("refuses results the agent cannot reproduce", () => {
    for (const name of [
      "ask_user",
      "record_hypotheses",
      "read_debug_logs",
      "edit_file",
      "run_shell",
      "fetch_url",
      "web_search",
    ]) {
      expect(isMaskableObservation(observation(name, 0))).toBe(false);
    }
  });
});

describe("maskOldObservations", () => {
  it("leaves a short session untouched", () => {
    const history = observations("read_file", 10);
    expect(maskOldObservations(history)).toBe(history);
  });

  it("masks the oldest observations and keeps the recent ones verbatim", () => {
    const history = archivedObservations("read_file", 14);
    const masked = maskOldObservations(history);

    expect(masked[0]?.content).toContain("output masked");
    expect(masked[0]?.content).toContain("read_session_artifact");
    expect(masked[3]?.content).toContain("output masked");
    expect(masked[4]?.content).toBe(history[4]?.content);
    expect(masked.at(-1)?.content).toBe(history.at(-1)?.content);
  });

  it("keeps the message sequence and tool linkage intact", () => {
    const history = observations("read_file", 14);
    const masked = maskOldObservations(history);

    expect(masked).toHaveLength(history.length);
    expect(masked.map((m) => m.toolCallId)).toEqual(history.map((m) => m.toolCallId));
    expect(masked.every((m) => m.role === "tool")).toBe(true);
    expect(masked).toEqual(history);
  });

  it("requires an artifact before replacing any observation body", () => {
    const legacy = observation("read_file", 0);
    const archived = archivedObservations("read_file", 1)[0]!;
    expect(hasRecoverableArtifact(legacy)).toBe(false);
    expect(hasRecoverableArtifact(archived)).toBe(true);
  });

  it("spares small outputs, where masking would only lose information", () => {
    const history = [
      ...archivedObservations("read_file", 12),
      ...archivedObservations("grep", 4),
    ];
    history[0] = { ...history[0]!, content: "exit 0" };
    const masked = maskOldObservations(history);

    expect(masked[0]?.content).toBe("exit 0");
    expect(masked[1]?.content).toContain("output masked");
  });

  it("preserves the path annotation superseded-read tracking depends on", () => {
    const history = archivedObservations("read_file", 14).map((m, i) => ({
      ...m,
      content: `[path:src/a${i}.ts]\n${m.content}`,
    }));
    const masked = maskOldObservations(history);

    expect(masked[0]?.content.startsWith("[path:src/a0.ts]\n")).toBe(true);
    expect(masked[0]?.content).toContain("output masked");
  });

  it("does not mask non-maskable tools however old they are", () => {
    const history = [
      observation("ask_user", 0),
      ...observations("run_shell", 14),
    ];
    const masked = maskOldObservations(history);

    expect(masked[0]?.content).toBe(history[0]?.content);
    expect(masked[1]?.content).toBe(history[1]?.content);
  });
});
