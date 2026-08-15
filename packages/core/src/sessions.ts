import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Message } from "@ninjacode/providers";
import type { AgentMode, RequestCheckpoint, SessionConfig, SessionState, TurnTrace } from "./types.js";
import { maskOldObservations } from "./observationMasking.js";
import { normalizeToolHistory } from "./toolHistory.js";
import { sessionArtifactsDir, sessionDataDir } from "@ninjacode/tools";
import { sessionEventLog } from "./sessionEventLog.js";

export interface PersistedSession extends SessionState {
  /** v1 stored only a lossy history; v2 adds append-only events and immutable artifacts. */
  contextVersion?: 1 | 2;
  /** Canonical bounded view sent to the model. `history` remains the UI compatibility alias. */
  modelView?: Message[];
  eventLog?: string;
  artifactsDir?: string;
  updatedAt: string;
  grants: string[];
  pinnedTask?: string;
  title?: string;
  /** Kept at the top of the history list and excluded from "New conversation" defaults. */
  pinned?: boolean;
  /** Hidden from the main history list unless explicitly shown. */
  archived?: boolean;
  /** Per-request checkpoint mapping (optional for legacy sessions). */
  requests?: RequestCheckpoint[];
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

function sessionsDir(agentDir: string): string {
  return path.join(agentDir, "sessions");
}

function sessionPath(agentDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(sessionsDir(agentDir), `${safe}.json`);
}

export async function saveSession(
  agentDir: string,
  state: PersistedSession,
): Promise<void> {
  const dir = sessionsDir(agentDir);
  await fs.mkdir(dir, { recursive: true });
  const tmp = sessionPath(agentDir, state.config.id) + ".tmp";
  const final = sessionPath(agentDir, state.config.id);
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, final);
}

export async function loadSession(
  agentDir: string,
  sessionId: string,
): Promise<PersistedSession | null> {
  try {
    const raw = await fs.readFile(sessionPath(agentDir, sessionId), "utf8");
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

/** Load and repair tool-call chains for safe LLM continuation. */
export async function loadSessionSafe(
  agentDir: string,
  sessionId: string,
): Promise<PersistedSession | null> {
  const saved = await loadSession(agentDir, sessionId);
  if (!saved) return null;
  return {
    ...saved,
    history: normalizeToolHistory(saved.history),
  };
}

export interface SessionSummary {
  id: string;
  title: string;
  mode: AgentMode;
  model?: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  preview: string;
  pinned: boolean;
  archived: boolean;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

export function deriveSessionTitle(
  history: Message[],
  pinnedTask?: string,
  existing?: string,
): string {
  if (existing?.trim()) return existing.trim().slice(0, 80);
  const firstUser = history.find((m) => m.role === "user");
  const raw = (pinnedTask || firstUser?.content || "New conversation").trim();
  const oneLine = raw.split(/\r?\n/).find((l) => l.trim()) ?? raw;
  return oneLine.slice(0, 80) || "New conversation";
}

export async function listSessions(agentDir: string): Promise<SessionSummary[]> {
  const dir = sessionsDir(agentDir);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const out: SessionSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      const s = JSON.parse(raw) as PersistedSession;
      const lastUser = [...s.history].reverse().find((m) => m.role === "user");
      const preview = (lastUser?.content ?? "").replace(/\s+/g, " ").slice(0, 120);
      out.push({
        id: s.config.id,
        title: deriveSessionTitle(s.history, s.pinnedTask, s.title ?? s.config.title),
        mode: s.config.mode,
        model: s.config.model,
        provider: s.config.provider,
        createdAt: s.config.createdAt,
        updatedAt: s.updatedAt,
        turnCount: s.turns.length,
        preview,
        pinned: Boolean(s.pinned),
        archived: Boolean(s.archived),
        totalUsage: s.totalUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      });
    } catch {
      // skip corrupt
    }
  }
  return out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function deleteSession(agentDir: string, sessionId: string): Promise<void> {
  await fs.unlink(sessionPath(agentDir, sessionId)).catch(() => undefined);
  await fs.rm(sessionDataDir(agentDir, sessionId), { recursive: true, force: true });
}

function artifactBackedTurns(turns: TurnTrace[]): TurnTrace[] {
  return turns.map((turn) => ({
    ...turn,
    toolInvocations: turn.toolInvocations.map((invocation) =>
      invocation.artifactId
        ? { ...invocation, output: `[archived artifact ${invocation.artifactId}]` }
        : invocation,
    ),
  }));
}

export function buildPersistedSession(opts: {
  config: SessionConfig;
  history: Message[];
  turns: TurnTrace[];
  grants: string[];
  pinnedTask?: string;
  modelView?: Message[];
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  requests?: RequestCheckpoint[];
}): PersistedSession {
  const totalUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const t of opts.turns) {
    totalUsage.inputTokens += t.usage.inputTokens;
    totalUsage.outputTokens += t.usage.outputTokens;
    totalUsage.cacheReadTokens += t.usage.cacheReadTokens ?? 0;
    totalUsage.cacheWriteTokens += t.usage.cacheWriteTokens ?? 0;
  }
  const title = deriveSessionTitle(opts.history, opts.pinnedTask, opts.title ?? opts.config.title);
  return {
    contextVersion: 2,
    config: { ...opts.config, title },
    history: opts.history,
    modelView: opts.modelView ?? maskOldObservations(opts.history),
    eventLog: "events.jsonl",
    artifactsDir: "artifacts",
    turns: artifactBackedTurns(opts.turns),
    grants: opts.grants,
    pinnedTask: opts.pinnedTask,
    title,
    pinned: opts.pinned,
    archived: opts.archived,
    requests: opts.requests,
    updatedAt: new Date().toISOString(),
    totalUsage,
  };
}

/** Raw history indices (0-based, into the full `history` array) of every `user`-role message, in order. */
export function userMessageIndices(history: Message[]): number[] {
  const out: number[] = [];
  history.forEach((m, i) => {
    if (m.role === "user") out.push(i);
  });
  return out;
}

/**
 * Resolve the checkpoint captured before the `ordinal`-th (0-based) user message of a
 * session, using its `requests` map. Returns null when the session has no request
 * mapping (legacy sessions) or no checkpoint matches — callers must then avoid
 * restoring an arbitrary checkpoint.
 */
export function checkpointIdForUserMessageOrdinal(
  session: Pick<PersistedSession, "history" | "requests">,
  ordinal: number,
): string | null {
  const requests = session.requests;
  if (!requests || requests.length === 0) return null;
  const rawIndex = userMessageIndices(session.history)[ordinal];
  if (rawIndex === undefined) return null;
  return requests.find((r) => r.userMessageIndex === rawIndex)?.checkpointId ?? null;
}

/**
 * Truncate `history`/`turns` right before `messageIndex` (i.e. drop that message and
 * everything after it). `turns` is truncated by counting `assistant` messages retained —
 * the agent pushes exactly one `TurnTrace` per assistant message it appends, in order, so
 * this stays in sync without needing an explicit message<->turn mapping.
 */
export function truncateHistoryAtMessageIndex(
  history: Message[],
  turns: TurnTrace[],
  messageIndex: number,
): { history: Message[]; turns: TurnTrace[]; removed: Message[] } {
  const clamped = Math.max(0, Math.min(messageIndex, history.length));
  const kept = history.slice(0, clamped);
  const removed = history.slice(clamped);
  const assistantCount = kept.filter((m) => m.role === "assistant").length;
  return { history: kept, turns: turns.slice(0, assistantCount), removed };
}

/**
 * Truncate at the `ordinal`-th (0-based) user message — i.e. remove that user message and
 * everything after it, leaving history ready for a new/edited message to be appended in its
 * place. Used by "edit and resend".
 */
export function truncateHistoryAtUserMessageOrdinal(
  history: Message[],
  turns: TurnTrace[],
  ordinal: number,
): { history: Message[]; turns: TurnTrace[]; removed: Message[] } {
  const indices = userMessageIndices(history);
  const rawIndex = indices[ordinal] ?? history.length;
  return truncateHistoryAtMessageIndex(history, turns, rawIndex);
}

/**
 * Clone `history`/`turns` through the end of the `ordinal`-th (0-based) user message's
 * exchange (i.e. up to, but not including, the *next* user message). Used by "fork from
 * here". When `ordinal` is undefined, clones the entire conversation.
 */
export function forkHistoryAtUserMessageOrdinal(
  history: Message[],
  turns: TurnTrace[],
  ordinal?: number,
): { history: Message[]; turns: TurnTrace[] } {
  if (ordinal === undefined) return { history: [...history], turns: [...turns] };
  const indices = userMessageIndices(history);
  const rawIndex = indices[ordinal];
  if (rawIndex === undefined) return { history: [...history], turns: [...turns] };
  const nextRawIndex = indices[ordinal + 1] ?? history.length;
  const { history: kept, turns: keptTurns } = truncateHistoryAtMessageIndex(history, turns, nextRawIndex);
  return { history: kept, turns: keptTurns };
}

/**
 * Truncate a *persisted* session on disk at the `ordinal`-th user message and save it back
 * in place (used right before resending an edited message).
 */
export async function truncateSessionAtUserMessageOrdinal(
  agentDir: string,
  sessionId: string,
  ordinal: number,
): Promise<PersistedSession | null> {
  const saved = await loadSession(agentDir, sessionId);
  if (!saved) return null;
  const { history, turns } = truncateHistoryAtUserMessageOrdinal(saved.history, saved.turns, ordinal);
  const updated: PersistedSession = {
    ...saved,
    history,
    modelView: history,
    turns,
    updatedAt: new Date().toISOString(),
  };
  await saveSession(agentDir, updated);
  await sessionEventLog(agentDir, sessionId).append("session_truncated", { ordinal });
  return updated;
}

/**
 * Append a system-authored note (as a `user` message, so the model reads it next turn)
 * to a persisted, idle session. Used to tell the agent about out-of-band workspace
 * changes it didn't make — a rejected edit or a restored checkpoint — so it stops
 * reasoning about a stale file state. No-op if the session is missing.
 */
export async function appendSessionNote(
  agentDir: string,
  sessionId: string,
  text: string,
): Promise<PersistedSession | null> {
  const saved = await loadSession(agentDir, sessionId);
  if (!saved) return null;
  const note = text.startsWith("[System]") ? text : `[System] ${text}`;
  const updated: PersistedSession = {
    ...saved,
    history: [...saved.history, { role: "user", content: note }],
    modelView: [...saved.history, { role: "user", content: note }],
    updatedAt: new Date().toISOString(),
  };
  await saveSession(agentDir, updated);
  await sessionEventLog(agentDir, sessionId).append("session_note", { content: note });
  return updated;
}

/**
 * Clone a persisted session into a brand-new session id, optionally stopping after the
 * `ordinal`-th (0-based) user message's exchange. Returns the new session, or null if the
 * source session doesn't exist.
 */
export async function forkSession(
  agentDir: string,
  sourceSessionId: string,
  opts: { uptoUserMessageOrdinal?: number; title?: string } = {},
): Promise<PersistedSession | null> {
  const source = await loadSession(agentDir, sourceSessionId);
  if (!source) return null;
  const { history, turns } = forkHistoryAtUserMessageOrdinal(
    source.history,
    source.turns,
    opts.uptoUserMessageOrdinal,
  );
  const now = new Date().toISOString();
  const baseTitle = source.title ?? deriveSessionTitle(source.history, source.pinnedTask);
  const forked: PersistedSession = {
    ...source,
    config: { ...source.config, id: randomUUID(), createdAt: now, title: opts.title ?? `${baseTitle} (fork)` },
    history,
    modelView: history,
    turns,
    title: opts.title ?? `${baseTitle} (fork)`,
    pinned: false,
    archived: false,
    updatedAt: now,
  };
  await saveSession(agentDir, forked);
  await fs.cp(
    sessionArtifactsDir(agentDir, sourceSessionId),
    sessionArtifactsDir(agentDir, forked.config.id),
    { recursive: true, force: false },
  ).catch(() => undefined);
  await sessionEventLog(agentDir, forked.config.id).append("session_forked", {
    sourceSessionId,
    uptoUserMessageOrdinal: opts.uptoUserMessageOrdinal,
  });
  return forked;
}

export async function renameSession(
  agentDir: string,
  sessionId: string,
  title: string,
): Promise<PersistedSession | null> {
  const saved = await loadSession(agentDir, sessionId);
  if (!saved) return null;
  const trimmed = title.trim().slice(0, 80);
  const updated: PersistedSession = {
    ...saved,
    title: trimmed || saved.title,
    config: { ...saved.config, title: trimmed || saved.config.title },
    updatedAt: new Date().toISOString(),
  };
  await saveSession(agentDir, updated);
  return updated;
}

export async function setSessionFlags(
  agentDir: string,
  sessionId: string,
  flags: { pinned?: boolean; archived?: boolean },
): Promise<PersistedSession | null> {
  const saved = await loadSession(agentDir, sessionId);
  if (!saved) return null;
  const updated: PersistedSession = {
    ...saved,
    pinned: flags.pinned ?? saved.pinned,
    archived: flags.archived ?? saved.archived,
  };
  await saveSession(agentDir, updated);
  return updated;
}

export function exportSessionAsJson(session: PersistedSession): string {
  return JSON.stringify(session, null, 2);
}

export function exportSessionAsMarkdown(session: PersistedSession): string {
  const title = session.title ?? deriveSessionTitle(session.history, session.pinnedTask);
  const lines: string[] = [`# ${title}`, ""];
  lines.push(`- Created: ${session.config.createdAt}`);
  lines.push(`- Updated: ${session.updatedAt}`);
  lines.push(`- Mode: ${session.config.mode}`);
  if (session.config.model) lines.push(`- Model: ${session.config.model}`);
  if (session.config.provider) lines.push(`- Provider: ${session.config.provider}`);
  lines.push("");

  for (const m of session.history) {
    if (m.role === "user") {
      if (m.content.startsWith("[Compacted earlier conversation]")) {
        lines.push("_(earlier conversation compacted)_", "");
        continue;
      }
      lines.push("## User", "", m.content, "");
    } else if (m.role === "assistant") {
      if (m.content.trim()) lines.push("## Assistant", "", m.content, "");
      for (const tc of m.toolCalls ?? []) {
        lines.push(`> 🔧 \`${tc.name}\`(${JSON.stringify(tc.arguments)})`, "");
      }
    } else if (m.role === "tool") {
      lines.push(
        `<details><summary>Tool result: ${m.name ?? "tool"}</summary>`,
        "",
        "```",
        m.content,
        "```",
        "</details>",
        "",
      );
    }
  }
  return lines.join("\n");
}
