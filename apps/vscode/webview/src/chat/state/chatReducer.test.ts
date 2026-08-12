import { describe, expect, it } from "vitest";
import type { HostToWebview } from "../types.js";
import { chatReducer, initialChatState, lastIndexOfKind, liveIndex, type ChatState } from "./chatReducer.js";

function reduce(messages: HostToWebview[], from: ChatState = initialChatState): ChatState {
  return messages.reduce((state, message) => chatReducer(state, { kind: "host", message }), from);
}

describe("streaming", () => {
  it("appends assistant deltas to the same bubble", () => {
    const state = reduce([
      { type: "assistant_delta", text: "Hel" },
      { type: "assistant_delta", text: "lo" },
    ]);
    expect(state.log).toEqual([{ kind: "assistant", text: "Hello" }]);
  });

  it("starts a new bubble after another entry", () => {
    const state = reduce([
      { type: "assistant_delta", text: "a" },
      { type: "status", text: "Running" },
      { type: "assistant_delta", text: "b" },
    ]);
    expect(state.log.filter((i) => i.kind === "assistant")).toHaveLength(2);
  });

  it("ignores empty deltas", () => {
    expect(reduce([{ type: "assistant_delta", text: "" }]).log).toEqual([]);
  });

  it("never stacks the Thinking placeholder", () => {
    const state = reduce([
      { type: "status", text: "Thinking…" },
      { type: "status", text: "Thinking…" },
    ]);
    expect(state.log).toHaveLength(1);
  });

  it("keeps live reasoning instead of replacing it with Thinking", () => {
    const state = reduce([
      { type: "reasoning_delta", text: "considering" },
      { type: "status", text: "Thinking…" },
    ]);
    expect(state.log.at(-1)?.kind).toBe("reasoning");
  });

  it("merges tool start and end into one card", () => {
    const state = reduce([
      { type: "tool", id: "t1", name: "read_file", label: "Read", status: "running" },
      { type: "tool", id: "t1", status: "done", output: "ok", durationMs: 12 },
    ]);
    expect(state.log).toHaveLength(1);
    expect(state.log[0]).toMatchObject({ kind: "tool", label: "Read", status: "done", output: "ok" });
  });

  it("carries context refs on user messages", () => {
    const refs = [{ id: "f1", kind: "file" as const, label: "a.ts", target: "a.ts", status: "resolved" as const }];
    const state = reduce([{ type: "user", text: "see @a.ts", refs }]);
    expect(state.log[0]).toEqual({ kind: "user", text: "see @a.ts", refs });
  });
});

describe("interactive cards", () => {
  it("resolves an approval in place", () => {
    const state = reduce([
      { type: "approval", requestId: "r1", toolName: "run_shell", target: "ls", reason: "why" },
      { type: "approval_resolved", requestId: "r1", approved: true },
    ]);
    expect(state.log[0]).toMatchObject({ kind: "approval", resolved: true, approved: true });
  });

  it("marks a cancelled approval", () => {
    const state = reduce([
      { type: "approval", requestId: "r1", toolName: "run_shell", target: "ls", reason: "why" },
      { type: "approval_resolved", requestId: "r1", approved: false, cancelled: true },
    ]);
    expect(state.log[0]).toMatchObject({
      kind: "approval",
      resolved: true,
      approved: false,
      cancelled: true,
    });
  });


  it("stores answers when a question resolves", () => {
    const state = reduce([
      { type: "question", requestId: "q1", questions: [{ id: "a", prompt: "?", options: [] }] },
      { type: "question_resolved", requestId: "q1", answers: [{ questionId: "a", freeText: "yes" }] },
    ]);
    expect(state.log[0]).toMatchObject({ resolved: true, answers: [{ questionId: "a", freeText: "yes" }] });
  });

  it("leaves other requests untouched", () => {
    const state = reduce([
      { type: "user_action", requestId: "u1", action: "restart" },
      { type: "user_action", requestId: "u2", action: "login" },
      { type: "user_action_resolved", requestId: "u2", comment: "done" },
    ]);
    expect(state.log[0]).not.toHaveProperty("resolved");
    expect(state.log[1]).toMatchObject({ resolved: true, comment: "done" });
  });
});

describe("hydration and reset", () => {
  it("replaces everything on hydrate and drops the plan", () => {
    const dirty = reduce([
      { type: "status", text: "old" },
      { type: "plan", planId: "abc12345", title: "Plan", path: "p.md", content: "x" },
    ]);
    const state = chatReducer(dirty, {
      kind: "host",
      message: {
        type: "hydrate",
        log: [{ kind: "user", text: "hi" }],
        todos: [{ id: "1", content: "do", status: "pending" }],
        pendingEdits: ["a.ts"],
        hypotheses: [],
        debugLogCount: 2,
        sessions: [],
        runState: "running",
        queue: [],
        contextUsage: null,
        sessionUsage: null,
        activeSessionId: "s1",
        showDragTip: true,
        onboardingDismissed: false,
      },
    });
    expect(state.log).toEqual([{ kind: "user", text: "hi" }]);
    expect(state.todos).toEqual([{ id: "1", content: "do", status: "pending" }]);
    expect(state.runState).toBe("running");
    expect(state.activeSessionId).toBe("s1");
    expect(state.plan).toBeNull();
    expect(state.showDragTip).toBe(true);
    expect(chatReducer(state, { kind: "dismiss_drag_tip" }).showDragTip).toBe(false);
  });

  it("skipping the welcome screen sticks for the rest of the session", () => {
    const skipped = chatReducer(initialChatState, { kind: "dismiss_onboarding" });
    expect(skipped.onboardingDismissed).toBe(true);
    const cleared = chatReducer(skipped, { kind: "host", message: { type: "clear" } });
    expect(cleared.onboardingDismissed).toBe(true);
    const reset = chatReducer(skipped, { kind: "host", message: { type: "reset_onboarding" } });
    expect(reset.onboardingDismissed).toBe(false);
  });

  it("keeps the session list on clear", () => {
    const withSessions = reduce([
      { type: "sessions", sessions: [{ id: "s1" } as never], activeSessionId: "s1" },
      { type: "status", text: "x" },
    ]);
    const cleared = chatReducer(withSessions, { kind: "host", message: { type: "clear" } });
    expect(cleared.log).toEqual([]);
    expect(cleared.sessions).toHaveLength(1);
    expect(cleared.activeSessionId).toBeUndefined();
  });
});

describe("panels", () => {
  it("stores hunks per path", () => {
    const state = reduce([
      { type: "hunks", path: "a.ts", hunks: [] },
      { type: "hunks", path: "b.ts", hunks: [] },
    ]);
    expect(Object.keys(state.hunksByPath)).toEqual(["a.ts", "b.ts"]);
  });

  it("tracks the auto-accept deadline", () => {
    expect(reduce([{ type: "auto_accept", deadline: 42 }]).autoAcceptDeadline).toBe(42);
    expect(reduce([{ type: "auto_accept", deadline: null }]).autoAcceptDeadline).toBeNull();
  });

  it("spreads the context usage payload", () => {
    const state = reduce([
      {
        type: "context_usage",
        system: 1,
        history: 2,
        tools: 3,
        files: 4,
        output: 5,
        total: 15,
        window: 100,
      },
    ]);
    expect(state.contextUsage).toEqual({
      system: 1,
      history: 2,
      tools: 3,
      files: 4,
      output: 5,
      total: 15,
      window: 100,
    });
  });

  it("keeps only the latest session usage total", () => {
    const state = reduce([
      {
        type: "usage",
        turns: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      {
        type: "usage",
        turns: 2,
        inputTokens: 320,
        outputTokens: 65,
        cacheReadTokens: 900,
        cacheWriteTokens: 40,
        model: "claude-sonnet-4-20250514",
      },
    ]);
    // The host publishes running totals, so the reducer replaces rather than adds.
    expect(state.sessionUsage).toEqual({
      turns: 2,
      inputTokens: 320,
      outputTokens: 65,
      cacheReadTokens: 900,
      cacheWriteTokens: 40,
      model: "claude-sonnet-4-20250514",
    });
  });

  it("drops session usage on clear", () => {
    const spent = reduce([
      {
        type: "usage",
        turns: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
    const cleared = chatReducer(spent, { kind: "host", message: { type: "clear" } });
    expect(cleared.sessionUsage).toBeNull();
  });

  it("ignores messages that are not conversation state", () => {
    const state = reduce([{ type: "voice_level", level: 0.5 }]);
    expect(state).toBe(initialChatState);
  });
});

describe("log queries", () => {
  const log = reduce([
    { type: "user", text: "go" },
    { type: "status", text: "Thinking…" },
    { type: "reasoning_delta", text: "hmm" },
  ]).log;

  it("finds the last entry of a kind", () => {
    expect(lastIndexOfKind(log, "user")).toBe(0);
    expect(lastIndexOfKind(log, "assistant")).toBe(-1);
  });

  it("reports live reasoning only while the agent runs", () => {
    const reasoningIndex = lastIndexOfKind(log, "reasoning");
    expect(reasoningIndex).toBeGreaterThan(0);
    expect(liveIndex(log, "reasoning", 0, true)).toBe(reasoningIndex);
    expect(liveIndex(log, "reasoning", 0, false)).toBe(-1);
  });

  it("drops the live status once reasoning supersedes it", () => {
    expect(liveIndex(log, "status", 0, true)).toBe(-1);
  });
});
