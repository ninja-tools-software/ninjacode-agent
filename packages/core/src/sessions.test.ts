import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import type { TurnTrace } from "./types.js";
import { normalizeToolHistory, alignCompactionStart, isValidToolChain } from "./toolHistory.js";
import { compactHistory, compactHistorySync } from "./context.js";
import {
  buildPersistedSession,
  deriveSessionTitle,
  listSessions,
  saveSession,
  loadSession,
  loadSessionSafe,
  deleteSession,
  userMessageIndices,
  checkpointIdForUserMessageOrdinal,
  appendSessionNote,
  truncateHistoryAtMessageIndex,
  truncateHistoryAtUserMessageOrdinal,
  forkHistoryAtUserMessageOrdinal,
  truncateSessionAtUserMessageOrdinal,
  forkSession,
  renameSession,
  setSessionFlags,
  exportSessionAsJson,
  exportSessionAsMarkdown,
} from "./sessions.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("normalizeToolHistory", () => {
  it("keeps valid assistant+tool chains", () => {
    const history: Message[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.ts" } }],
      },
      { role: "tool", content: "a", toolCallId: "c1", name: "read_file" },
      { role: "assistant", content: "done" },
    ];
    expect(normalizeToolHistory(history)).toHaveLength(4);
  });

  it("drops orphan tool messages", () => {
    const history: Message[] = [
      { role: "user", content: "summary" },
      { role: "tool", content: "x", toolCallId: "c1", name: "read_file" },
    ];
    const out = normalizeToolHistory(history);
    expect(out.every((m) => m.role !== "tool")).toBe(true);
  });

  it("synthesizes missing tool results", () => {
    const history: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { path: "a.ts" } },
          { id: "c2", name: "read_file", arguments: { path: "b.ts" } },
        ],
      },
      { role: "tool", content: "a", toolCallId: "c1", name: "read_file" },
    ];
    const out = normalizeToolHistory(history);
    const tools = out.filter((m) => m.role === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[1]?.content).toContain("unavailable");
  });
});

describe("alignCompactionStart", () => {
  it("moves cut before assistant when slicing mid-tool-block", () => {
    const msgs: Message[] = [
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { path: "a.ts" } },
          { id: "c2", name: "read_file", arguments: { path: "b.ts" } },
        ],
      },
      { role: "tool", content: "a", toolCallId: "c1", name: "read_file" },
      { role: "tool", content: "b", toolCallId: "c2", name: "read_file" },
    ];
    expect(alignCompactionStart(msgs, 3)).toBe(1);
  });
});

describe("compactHistory tool integrity", () => {
  it("does not leave a tool preceded by another tool", async () => {
    const pad: Message[] = Array.from({ length: 50 }, (_, i) => ({
      role: "user" as const,
      content: `f${i}`,
    }));
    const history: Message[] = [
      ...pad,
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "read_file", arguments: { path: "a.ts" } },
          { id: "c2", name: "read_file", arguments: { path: "b.ts" } },
        ],
      },
      {
        role: "tool",
        content: "[path:a.ts]\na",
        toolCallId: "c1",
        name: "read_file",
      },
      {
        role: "tool",
        content: "[path:b.ts]\nb",
        toolCallId: "c2",
        name: "read_file",
      },
    ];
    const out = await compactHistory({
      history,
      pinnedTask: "task",
      contextWindow: 64_000,
    });
    expect(isValidToolChain(out)).toBe(true);
  });

  it("compactHistorySync preserves tool blocks", () => {
    const history: Message[] = Array.from({ length: 90 }, (_, i) => {
      if (i % 3 === 0) return { role: "user" as const, content: `u${i}` };
      if (i % 3 === 1) {
        return {
          role: "assistant" as const,
          content: "",
          toolCalls: [{ id: `c${i}`, name: "list_dir", arguments: { path: "." } }],
        };
      }
      return {
        role: "tool" as const,
        content: "ok",
        toolCallId: `c${i - 1}`,
        name: "list_dir",
      };
    });
    const out = compactHistorySync(history, "task");
    expect(isValidToolChain(out)).toBe(true);
  });
});

describe("sessions metadata", () => {
  it("derives title from first user message", () => {
    expect(
      deriveSessionTitle([{ role: "user", content: "Fix the flaky test\nmore" }], undefined),
    ).toBe("Fix the flaky test");
  });

  it("lists, loads safely, and deletes sessions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-hist-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const state = buildPersistedSession({
        config: {
          id: "sess1",
          workspaceRoot: dir,
          mode: "agent",
          model: "deepseek-chat",
          provider: "deepseek",
          createdAt: new Date().toISOString(),
        },
        history: [
          { role: "user", content: "Hello history" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: "list_dir", arguments: { path: "." } }],
          },
          // orphan would be bad — include matching tool
          { role: "tool", content: "files", toolCallId: "c1", name: "list_dir" },
          { role: "assistant", content: "Listed." },
        ],
        turns: [
          {
            turn: 0,
            assistantText: "Listed.",
            toolInvocations: [],
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
        grants: [],
        pinnedTask: "Hello history",
      });
      await saveSession(agentDir, state);

      // Corrupt a copy with orphan tool then save under another id
      await saveSession(agentDir, {
        ...state,
        config: { ...state.config, id: "sess2", title: "Broken" },
        title: "Broken",
        history: [
          { role: "user", content: "Broken" },
          { role: "tool", content: "orphan", toolCallId: "x", name: "read_file" },
        ],
      });

      const listed = await listSessions(agentDir);
      expect(listed.length).toBe(2);
      expect(listed[0]?.title).toBeTruthy();
      expect(listed.find((s) => s.id === "sess1")?.totalUsage.inputTokens).toBe(10);

      const safe = await loadSessionSafe(agentDir, "sess2");
      expect(safe?.history.every((m) => m.role !== "tool" || m.toolCallId)).toBe(true);
      expect(safe?.history.some((m) => m.role === "tool" && m.toolCallId === "x")).toBe(false);

      await deleteSession(agentDir, "sess2");
      const after = await listSessions(agentDir);
      expect(after.map((s) => s.id)).toEqual(["sess1"]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("sorts pinned sessions first, then by recency", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-hist-pin-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const makeState = (id: string, updatedAt: string, pinned?: boolean) => ({
        ...buildPersistedSession({
          config: { id, workspaceRoot: dir, mode: "agent" as const, createdAt: updatedAt },
          history: [{ role: "user" as const, content: id }],
          turns: [],
          grants: [],
          pinned,
        }),
        updatedAt,
      });
      await saveSession(agentDir, makeState("old-pinned", "2024-01-01T00:00:00.000Z", true));
      await saveSession(agentDir, makeState("newest", "2024-03-01T00:00:00.000Z"));
      await saveSession(agentDir, makeState("older", "2024-02-01T00:00:00.000Z"));

      const listed = await listSessions(agentDir);
      expect(listed.map((s) => s.id)).toEqual(["old-pinned", "newest", "older"]);
      expect(listed[0]?.pinned).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("userMessageIndices", () => {
  it("returns raw history indices of every user message", () => {
    const history: Message[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "reply" },
      { role: "tool", content: "x", toolCallId: "c1", name: "read_file" },
      { role: "user", content: "b" },
    ];
    expect(userMessageIndices(history)).toEqual([0, 3]);
  });
});

describe("checkpointIdForUserMessageOrdinal", () => {
  const history: Message[] = [
    { role: "user", content: "first" }, // raw index 0
    { role: "assistant", content: "reply 1" },
    { role: "tool", content: "x", toolCallId: "c1", name: "read_file" },
    { role: "user", content: "second" }, // raw index 3
    { role: "assistant", content: "reply 2" },
  ];

  it("maps a user-message ordinal to the checkpoint captured before it", () => {
    const session = {
      history,
      requests: [
        { checkpointId: "cp-0", userMessageIndex: 0 },
        { checkpointId: "cp-3", userMessageIndex: 3 },
      ],
    };
    expect(checkpointIdForUserMessageOrdinal(session, 0)).toBe("cp-0");
    expect(checkpointIdForUserMessageOrdinal(session, 1)).toBe("cp-3");
  });

  it("returns null for legacy sessions without a request map or unmatched ordinals", () => {
    expect(checkpointIdForUserMessageOrdinal({ history, requests: undefined }, 0)).toBeNull();
    expect(checkpointIdForUserMessageOrdinal({ history, requests: [] }, 0)).toBeNull();
    expect(
      checkpointIdForUserMessageOrdinal(
        { history, requests: [{ checkpointId: "cp-0", userMessageIndex: 0 }] },
        1,
      ),
    ).toBeNull();
    expect(
      checkpointIdForUserMessageOrdinal(
        { history, requests: [{ checkpointId: "cp-0", userMessageIndex: 0 }] },
        9,
      ),
    ).toBeNull();
  });
});

describe("appendSessionNote", () => {
  it("appends a [System] user note to an idle persisted session", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-note-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const state = buildPersistedSession({
        config: { id: "s1", workspaceRoot: dir, mode: "agent", createdAt: new Date().toISOString() },
        history: [
          { role: "user", content: "do the thing" },
          { role: "assistant", content: "done" },
        ],
        turns: [],
        grants: [],
      });
      await saveSession(agentDir, state);

      const updated = await appendSessionNote(agentDir, "s1", "The user restored a checkpoint.");
      expect(updated?.history).toHaveLength(3);
      const lastMsg = updated?.history.at(-1);
      expect(lastMsg?.role).toBe("user");
      expect(lastMsg?.content).toBe("[System] The user restored a checkpoint.");

      const reloaded = await loadSession(agentDir, "s1");
      expect(reloaded?.history.at(-1)?.content).toBe("[System] The user restored a checkpoint.");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not double-prefix an existing [System] marker and no-ops on missing sessions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-note2-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const state = buildPersistedSession({
        config: { id: "s1", workspaceRoot: dir, mode: "agent", createdAt: new Date().toISOString() },
        history: [{ role: "user", content: "hi" }],
        turns: [],
        grants: [],
      });
      await saveSession(agentDir, state);

      const updated = await appendSessionNote(agentDir, "s1", "[System] Already prefixed.");
      expect(updated?.history.at(-1)?.content).toBe("[System] Already prefixed.");

      expect(await appendSessionNote(agentDir, "missing", "note")).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("persisted requests round-trip", () => {
  it("saves and reloads the per-request checkpoint map", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-req-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const state = buildPersistedSession({
        config: { id: "s1", workspaceRoot: dir, mode: "agent", createdAt: new Date().toISOString() },
        history: [{ role: "user", content: "hi" }],
        turns: [],
        grants: [],
        requests: [{ checkpointId: "cp-0", userMessageIndex: 0 }],
      });
      await saveSession(agentDir, state);

      const reloaded = await loadSession(agentDir, "s1");
      expect(reloaded?.requests).toEqual([{ checkpointId: "cp-0", userMessageIndex: 0 }]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("truncateHistoryAtMessageIndex", () => {
  const history: Message[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply 1" },
    { role: "user", content: "second" },
    { role: "assistant", content: "reply 2" },
    { role: "user", content: "third" },
  ];
  const turns: TurnTrace[] = [
    { turn: 0, assistantText: "reply 1", toolInvocations: [], usage: { inputTokens: 1, outputTokens: 1 } },
    { turn: 1, assistantText: "reply 2", toolInvocations: [], usage: { inputTokens: 1, outputTokens: 1 } },
  ];

  it("keeps everything strictly before the cut and drops the corresponding turns", () => {
    const out = truncateHistoryAtMessageIndex(history, turns, 2);
    expect(out.history.map((m) => m.content)).toEqual(["first", "reply 1"]);
    expect(out.turns).toHaveLength(1);
    expect(out.removed.map((m) => m.content)).toEqual(["second", "reply 2", "third"]);
  });

  it("clamps out-of-range indices", () => {
    expect(truncateHistoryAtMessageIndex(history, turns, 999).history).toHaveLength(5);
    expect(truncateHistoryAtMessageIndex(history, turns, -5).history).toHaveLength(0);
  });
});

describe("truncateHistoryAtUserMessageOrdinal / forkHistoryAtUserMessageOrdinal", () => {
  const history: Message[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply 1" },
    { role: "user", content: "second" },
    { role: "assistant", content: "reply 2" },
    { role: "user", content: "third" },
    { role: "assistant", content: "reply 3" },
  ];
  const turns: TurnTrace[] = [0, 1, 2].map((turn) => ({
    turn,
    assistantText: `reply ${turn + 1}`,
    toolInvocations: [],
    usage: { inputTokens: 1, outputTokens: 1 },
  }));

  it("truncates right before the Nth user message (for edit & resend)", () => {
    const out = truncateHistoryAtUserMessageOrdinal(history, turns, 1);
    expect(out.history.map((m) => m.content)).toEqual(["first", "reply 1"]);
    expect(out.turns).toHaveLength(1);
  });

  it("forks through the end of the Nth user message's exchange", () => {
    const out = forkHistoryAtUserMessageOrdinal(history, turns, 0);
    expect(out.history.map((m) => m.content)).toEqual(["first", "reply 1"]);
    expect(out.turns).toHaveLength(1);
  });

  it("forks the full conversation when no ordinal is given", () => {
    const out = forkHistoryAtUserMessageOrdinal(history, turns);
    expect(out.history).toHaveLength(history.length);
    expect(out.turns).toHaveLength(turns.length);
    // Must be a clone, not the same array reference.
    expect(out.history).not.toBe(history);
  });
});

describe("session mutation helpers (fork/rename/flags/export)", () => {
  it("forks a session up to a given user message and persists it under a new id", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-fork-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const state = buildPersistedSession({
        config: { id: "src", workspaceRoot: dir, mode: "agent", createdAt: new Date().toISOString() },
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "reply 1" },
          { role: "user", content: "second" },
          { role: "assistant", content: "reply 2" },
        ],
        turns: [
          { turn: 0, assistantText: "reply 1", toolInvocations: [], usage: { inputTokens: 1, outputTokens: 1 } },
          { turn: 1, assistantText: "reply 2", toolInvocations: [], usage: { inputTokens: 1, outputTokens: 1 } },
        ],
        grants: [],
      });
      await saveSession(agentDir, state);

      const forked = await forkSession(agentDir, "src", { uptoUserMessageOrdinal: 0 });
      expect(forked).not.toBeNull();
      expect(forked!.config.id).not.toBe("src");
      expect(forked!.history.map((m) => m.content)).toEqual(["first", "reply 1"]);
      expect(forked!.title).toContain("(fork)");

      const reloaded = await loadSession(agentDir, forked!.config.id);
      expect(reloaded?.history).toHaveLength(2);

      expect(await forkSession(agentDir, "missing")).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("truncates a persisted session at a user-message ordinal (edit & resend)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-truncate-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const state = buildPersistedSession({
        config: { id: "s1", workspaceRoot: dir, mode: "agent", createdAt: new Date().toISOString() },
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "reply 1" },
          { role: "user", content: "second" },
          { role: "assistant", content: "reply 2" },
        ],
        turns: [
          { turn: 0, assistantText: "reply 1", toolInvocations: [], usage: { inputTokens: 1, outputTokens: 1 } },
          { turn: 1, assistantText: "reply 2", toolInvocations: [], usage: { inputTokens: 1, outputTokens: 1 } },
        ],
        grants: [],
      });
      await saveSession(agentDir, state);

      const truncated = await truncateSessionAtUserMessageOrdinal(agentDir, "s1", 1);
      expect(truncated?.history.map((m) => m.content)).toEqual(["first", "reply 1"]);

      const reloaded = await loadSession(agentDir, "s1");
      expect(reloaded?.history).toHaveLength(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("renames a session and toggles pinned/archived flags", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-flags-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const state = buildPersistedSession({
        config: { id: "s1", workspaceRoot: dir, mode: "agent", createdAt: new Date().toISOString() },
        history: [{ role: "user", content: "hi" }],
        turns: [],
        grants: [],
      });
      await saveSession(agentDir, state);

      const renamed = await renameSession(agentDir, "s1", "My renamed chat");
      expect(renamed?.title).toBe("My renamed chat");

      const pinned = await setSessionFlags(agentDir, "s1", { pinned: true });
      expect(pinned?.pinned).toBe(true);
      expect(pinned?.title).toBe("My renamed chat");

      const archived = await setSessionFlags(agentDir, "s1", { archived: true });
      expect(archived?.archived).toBe(true);
      expect(archived?.pinned).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("exports a session as JSON and Markdown", () => {
    const state = buildPersistedSession({
      config: { id: "s1", workspaceRoot: "/tmp", mode: "agent", createdAt: new Date().toISOString() },
      history: [
        { role: "user", content: "Fix the bug" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.ts" } }],
        },
        { role: "tool", content: "file contents", toolCallId: "c1", name: "read_file" },
        { role: "assistant", content: "Fixed it." },
      ],
      turns: [],
      grants: [],
    });

    const json = exportSessionAsJson(state);
    expect(JSON.parse(json)).toMatchObject({ config: { id: "s1" } });

    const md = exportSessionAsMarkdown(state);
    expect(md).toContain("## User");
    expect(md).toContain("Fix the bug");
    expect(md).toContain("read_file");
    expect(md).toContain("Fixed it.");
  });
});
