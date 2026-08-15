import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareLegacySessionContext } from "./sessionMigration.js";
import { sessionEventLog } from "./sessionEventLog.js";
import type { PersistedSession } from "./sessions.js";

function legacySession(): PersistedSession {
  return {
    config: {
      id: "legacy",
      workspaceRoot: "/tmp/workspace",
      mode: "agent",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    history: [
      { role: "user", content: "inspect" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", name: "read_file", arguments: { path: "large.txt" } },
          { id: "call-2", name: "grep", arguments: { pattern: "sentinel" } },
        ],
      },
      {
        role: "tool",
        content: "[truncated]",
        name: "read_file",
        toolCallId: "call-1",
      },
      {
        role: "tool",
        content: "[output masked]",
        name: "grep",
        toolCallId: "call-2",
      },
    ],
    turns: [
      {
        turn: 0,
        assistantText: "",
        toolInvocations: [
          {
            toolCall: { id: "call-1", name: "read_file", arguments: { path: "large.txt" } },
            output: "full legacy output",
            approved: true,
            durationMs: 1,
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ],
    grants: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    totalUsage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

describe("prepareLegacySessionContext", () => {
  it("creates v2 sidecars without rewriting the legacy session file", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-migration-"));
    const sessions = path.join(agentDir, "sessions");
    await fs.mkdir(sessions, { recursive: true });
    const file = path.join(sessions, "legacy.json");
    const original = `${JSON.stringify(legacySession(), null, 2)}\n`;
    await fs.writeFile(file, original);

    const migrated = await prepareLegacySessionContext(agentDir, legacySession());
    expect(migrated.contextVersion).toBe(2);
    expect(migrated.modelView).toEqual(migrated.history);
    expect(await fs.readFile(file, "utf8")).toBe(original);

    const events = await sessionEventLog(agentDir, "legacy").readAll();
    const tool = events.find((event) => event.type === "tool_result");
    expect(tool?.payload.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(events.some((event) => event.type === "legacy_unrecoverable")).toBe(true);
  });
});
