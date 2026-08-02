import { describe, expect, it } from "vitest";
import type { ToolEventPayload } from "./protocol.js";
import { upsertToolInLog } from "./toolLogUi.js";

describe("upsertToolInLog", () => {
  it("appends a new card when the id is unseen", () => {
    const start: ToolEventPayload = {
      id: "t1",
      name: "read_file",
      label: "Reading foo.ts",
      status: "running",
    };
    const log = upsertToolInLog([], start);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "tool", id: "t1", status: "running" });
  });

  it("merges tool_end fields into an existing card by id", () => {
    const start: ToolEventPayload = {
      id: "t1",
      name: "read_file",
      label: "Reading foo.ts",
      status: "running",
    };
    const end: ToolEventPayload = {
      id: "t1",
      status: "done",
      output: "file contents",
      durationMs: 42,
    };
    const log = upsertToolInLog(upsertToolInLog([], start), end);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      kind: "tool",
      id: "t1",
      name: "read_file",
      label: "Reading foo.ts",
      status: "done",
      output: "file contents",
      durationMs: 42,
    });
  });

  it("ignores events without an id", () => {
    const log = upsertToolInLog([], { name: "search", status: "done" });
    expect(log).toHaveLength(0);
  });
});
