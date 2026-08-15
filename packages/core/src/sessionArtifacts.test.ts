import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSessionArtifactTool,
  sessionArtifactPaths,
  sessionArtifactsDir,
} from "@ninjacode/tools";
import { SessionArtifactStore } from "./sessionArtifacts.js";
import { SessionEventLog } from "./sessionEventLog.js";

const roots: string[] = [];

async function temporaryAgentDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-artifacts-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("SessionArtifactStore", () => {
  it("stores immutable content and reads it byte-for-byte with pagination", async () => {
    const agentDir = await temporaryAgentDir();
    const store = new SessionArtifactStore(agentDir, "session-1");
    const original = `prefix\n${"0123456789".repeat(2_000)}\nsentinel`;
    const first = await store.putText(original, {
      kind: "tool_output",
      toolName: "run_shell",
      toolCallId: "call-1",
    });
    const second = await store.putText(original, {
      kind: "tool_output",
      toolName: "run_shell",
      toolCallId: "call-1",
    });
    expect(second.id).toBe(first.id);
    const files = sessionArtifactPaths(agentDir, "session-1", first.id);
    expect(await fs.readFile(files.body, "utf8")).toBe(original);

    const page = await readSessionArtifactTool.execute(
      { workspaceRoot: agentDir, agentDir, sessionId: "session-1" },
      { artifact_id: first.id, offset: 5, limit: 20 },
    );
    expect(page.output).toContain(original.slice(5, 25));
    const search = await readSessionArtifactTool.execute(
      { workspaceRoot: agentDir, agentDir, sessionId: "session-1" },
      { artifact_id: first.id, query: "sentinel" },
    );
    expect(search.output).toContain("sentinel");
  });

  it("detects artifact tampering", async () => {
    const agentDir = await temporaryAgentDir();
    const artifact = await new SessionArtifactStore(agentDir, "s").putText("trusted", {
      kind: "tool_output",
    });
    const files = sessionArtifactPaths(agentDir, "s", artifact.id);
    await fs.writeFile(files.body, "tampered");
    await expect(
      readSessionArtifactTool.execute(
        { workspaceRoot: agentDir, agentDir, sessionId: "s" },
        { artifact_id: artifact.id },
      ),
    ).rejects.toThrow(/verification failed/);
    expect(sessionArtifactsDir(agentDir, "s")).toContain(path.join("s", "artifacts"));
  });

  it("archives a compaction segment that is re-readable byte-for-byte", async () => {
    const agentDir = await temporaryAgentDir();
    const store = new SessionArtifactStore(agentDir, "compact");
    const segment = [
      { role: "user", content: "BEGIN_SENTINEL" },
      { role: "assistant", content: "MIDDLE_SENTINEL" },
      { role: "user", content: "END_SENTINEL" },
    ];
    const raw = JSON.stringify(segment);
    const artifact = await store.putText(raw, {
      kind: "compaction_segment",
      mimeType: "application/json",
    });
    const files = sessionArtifactPaths(agentDir, "compact", artifact.id);
    expect(await fs.readFile(files.body, "utf8")).toBe(raw);
    const page = await readSessionArtifactTool.execute(
      { workspaceRoot: agentDir, agentDir, sessionId: "compact" },
      { artifact_id: artifact.id },
    );
    expect(page.output).toContain("BEGIN_SENTINEL");
    expect(page.output).toContain("END_SENTINEL");
  });
});

describe("SessionEventLog", () => {
  it("serializes concurrent appends with monotonic sequence numbers", async () => {
    const agentDir = await temporaryAgentDir();
    const log = new SessionEventLog(agentDir, "parallel");
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => log.append("legacy_message", { index })),
    );
    const events = await log.readAll();
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(events).toHaveLength(20);
  });
});
