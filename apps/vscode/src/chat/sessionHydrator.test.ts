import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import type { ProposedEditsStore } from "../proposedEdits.js";
import {
  buildChangesPayload,
  historyToUiLog,
  sessionHasPlan,
  toolOutputLooksLikeError,
} from "./sessionHydrator.js";

function store(entries: ReturnType<ProposedEditsStore["listWithStats"]>): ProposedEditsStore {
  return { listWithStats: () => entries } as unknown as ProposedEditsStore;
}

describe("buildChangesPayload", () => {
  it("projects the edit store onto the panel's shape", () => {
    const payload = buildChangesPayload(
      store([
        { path: "src/a.ts", additions: 3, deletions: 1, sensitive: false, sessionId: "s1" },
        { path: ".env", additions: 1, deletions: 0, sensitive: true, sessionId: "s1" },
      ] as ReturnType<ProposedEditsStore["listWithStats"]>),
    );
    expect(payload).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1, sensitive: false, sessionId: "s1" },
      { path: ".env", additions: 1, deletions: 0, sensitive: true, sessionId: "s1" },
    ]);
  });

  it("is empty when nothing is proposed", () => {
    expect(buildChangesPayload(store([]))).toEqual([]);
  });
});

describe("historyToUiLog", () => {
  it("keeps user and assistant turns in order", () => {
    const log = historyToUiLog([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ] as Message[]);
    expect(log).toEqual([
      { kind: "user", text: "hello" },
      { kind: "assistant", text: "hi" },
    ]);
  });

  it("hides the attached context block from the user bubble", () => {
    const log = historyToUiLog([
      { role: "user", content: "explain @a.ts\n\n---\nAttached context:\n\n### a.ts\nconst a = 1;" },
    ] as Message[]);
    expect(log).toEqual([{ kind: "user", text: "explain @a.ts" }]);
  });

  it("replaces a compaction marker with a status line", () => {
    const log = historyToUiLog([
      { role: "user", content: "[Compacted earlier conversation] summary…" },
    ] as Message[]);
    expect(log[0]).toEqual({ kind: "status", text: "⋯ earlier conversation compacted" });
  });

  it("pairs a tool call with its result", () => {
    const log = historyToUiLog([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "read_file", arguments: { path: "src/a.ts" } }],
      },
      { role: "tool", name: "read_file", content: "const a = 1;" },
    ] as Message[]);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "tool", name: "read_file", status: "done", output: "const a = 1;" });
  });

  it("marks a failed tool result as an error", () => {
    const log = historyToUiLog([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "run_shell", arguments: {} }] },
      { role: "tool", name: "run_shell", content: "Tool error [NotFound]: Cannot read missing.ts" },
    ] as Message[]);
    expect(log[0]).toMatchObject({ status: "error" });
  });

  it("still treats a legacy ✗ prefix as an error", () => {
    const log = historyToUiLog([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "run_shell", arguments: {} }] },
      { role: "tool", name: "run_shell", content: "✗ command failed" },
    ] as Message[]);
    expect(log[0]).toMatchObject({ status: "error" });
  });

  it("does not treat a successful read that mentions error as a failure", () => {
    const content = [
      "[path:src/context.ts#L206-305]",
      '277|  "## Errors",',
      '278|  "Failures encountered and what they revealed. Quote short error strings exactly.",',
    ].join("\n");
    const log = historyToUiLog([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "read_file", arguments: { path: "src/context.ts", offset: 206, limit: 100 } }],
      },
      { role: "tool", name: "read_file", content },
    ] as Message[]);
    expect(log[0]).toMatchObject({ kind: "tool", status: "done", output: content });
  });

  it("keeps a full read_file result instead of clipping at 4k", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${206 + i}|${"x".repeat(80)}`);
    const content = `[path:src/context.ts#L206-305]\n${lines.join("\n")}`;
    expect(content.length).toBeGreaterThan(4000);
    expect(content.length).toBeLessThan(40_000);
    const log = historyToUiLog([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "1", name: "read_file", arguments: { path: "src/context.ts" } }],
      },
      { role: "tool", name: "read_file", content },
    ] as Message[]);
    expect(log[0]).toMatchObject({ status: "done", output: content });
  });

  it("marks oversized tool output with a truncation notice", () => {
    const content = `${"line\n".repeat(6_000)}done`;
    const log = historyToUiLog([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "run_shell", arguments: {} }] },
      { role: "tool", name: "run_shell", content },
    ] as Message[]);
    const item = log[0];
    expect(item?.kind).toBe("tool");
    if (item?.kind !== "tool") return;
    expect(item.output).toContain("truncated");
    expect(item.output!.length).toBeLessThan(content.length);
  });

  it("skips interactive tools, which are replayed as cards elsewhere", () => {
    const log = historyToUiLog([
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "ask_user", arguments: {} }] },
      { role: "tool", name: "ask_user", content: "yes" },
    ] as Message[]);
    expect(log).toEqual([]);
  });

  it("drops an empty assistant turn that only carried tool calls", () => {
    const log = historyToUiLog([
      { role: "assistant", content: "   ", toolCalls: [{ id: "1", name: "glob", arguments: {} }] },
    ] as Message[]);
    expect(log.map((i) => i.kind)).toEqual(["tool"]);
  });
});

describe("toolOutputLooksLikeError", () => {
  it("matches pipeline failure prefixes", () => {
    expect(toolOutputLooksLikeError("Tool error [Timeout]: hung")).toBe(true);
    expect(toolOutputLooksLikeError("User denied this tool call.")).toBe(true);
    expect(toolOutputLooksLikeError("Tool read_file circuit-open after repeated failures this session.")).toBe(
      true,
    );
  });

  it("ignores the word error in successful output", () => {
    expect(toolOutputLooksLikeError("## Errors\nQuote short error strings exactly.")).toBe(false);
    expect(toolOutputLooksLikeError("isAbortError: (error: unknown) => boolean;")).toBe(false);
  });
});

describe("sessionHasPlan", () => {
  const session = (over: Record<string, unknown>) =>
    ({ config: { mode: "agent" }, history: [], ...over }) as never;

  it("is true in plan mode even before anything is written", () => {
    expect(sessionHasPlan(session({ config: { mode: "plan" } }))).toBe(true);
  });

  it("is true once the scratchpad was written", () => {
    expect(
      sessionHasPlan(
        session({
          history: [
            { role: "assistant", content: "", toolCalls: [{ id: "1", name: "write_scratchpad", arguments: {} }] },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is false for a plain agent session", () => {
    expect(sessionHasPlan(session({ history: [{ role: "user", content: "hi" }] }))).toBe(false);
  });
});
