import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  persistRedactedEventsJsonl,
  siblingArtifactPath,
  summarizeToolArgs,
  ToolTimelineRecorder,
} from "./toolTimeline.js";

describe("tool timeline", () => {
  it("records truncated shell commands and per-turn batch size", () => {
    const recorder = new ToolTimelineRecorder({ sessionId: "s1", startedAt: 1_000 });
    recorder.recordAgentEvent({
      type: "usage",
      payload: { turn: 1, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 } },
    }, 1_010);
    recorder.recordAgentEvent({
      type: "tool_start",
      payload: { id: "a", name: "list_dir", arguments: { path: "." }, target: "." },
    }, 1_020);
    recorder.recordAgentEvent({
      type: "tool_start",
      payload: {
        id: "b",
        name: "run_shell",
        arguments: { command: "python3 -c 'print(open(\"image.ppm\").read()[:80])'" },
        target: "shell",
      },
    }, 1_021);
    recorder.recordAgentEvent({ type: "tool_end", payload: { id: "a" } }, 1_030);
    recorder.recordAgentEvent({ type: "tool_end", payload: { id: "b" } }, 1_040);
    const timeline = recorder.finalize(1_050);
    expect(timeline.tools).toHaveLength(2);
    expect(timeline.tools.every((tool) => tool.batchSize === 2)).toBe(true);
    expect(timeline.turns[0]).toMatchObject({ turn: 1, toolCount: 2, batchSize: 2, inputTokens: 10 });
    expect(timeline.tools[1]?.argPreview).toContain("image.ppm");
  });

  it("records raw versus visible shell output size", () => {
    const recorder = new ToolTimelineRecorder({ sessionId: "s1", startedAt: 1_000 });
    recorder.recordAgentEvent({
      type: "tool_start",
      payload: { id: "a", name: "run_shell", arguments: { command: "cat image.ppm" } },
    }, 1_020);
    recorder.recordAgentEvent({
      type: "tool_end",
      payload: {
        id: "a",
        meta: { outputChars: 12_000, visibleChars: 8_000, truncated: true },
      },
    }, 1_030);
    expect(recorder.finalize(1_040).tools[0]).toMatchObject({
      outputChars: 12_000,
      visibleChars: 8_000,
      truncated: true,
    });
  });

  it("summarizes paths and omits write bodies", () => {
    expect(summarizeToolArgs("read_file", { path: "src/a.ts" })).toBe("src/a.ts");
    expect(summarizeToolArgs("write_file", { path: "image.c", content: "int main(){}" })).toBe("image.c");
    expect(summarizeToolArgs("apply_patch", { patch: "--- a\n+++ b\n" })).toBe("patch:12 chars");
  });

  it("redacts secrets when copying events.jsonl", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-timeline-"));
    const source = path.join(dir, "events.jsonl");
    const dest = siblingArtifactPath(path.join(dir, "trajectory.json"), "events.jsonl");
    await fs.writeFile(source, `${JSON.stringify({ type: "tool_result", payload: { token: "sk-abcdefghijklmnopqrstuvwxyz" } })}\n`);
    expect(await persistRedactedEventsJsonl(source, dest)).toBe(true);
    const copied = await fs.readFile(dest, "utf8");
    expect(copied).toContain("REDACTED");
    expect(copied).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});
