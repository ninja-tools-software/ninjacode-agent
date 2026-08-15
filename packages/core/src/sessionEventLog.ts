import fs from "node:fs/promises";
import path from "node:path";
import { sessionDataDir } from "@ninjacode/tools";

export type SessionEventType =
  | "user_message"
  | "assistant_message"
  | "tool_result"
  | "compaction"
  | "observation_archived"
  | "legacy_message"
  | "legacy_unrecoverable"
  | "session_truncated"
  | "session_forked"
  | "session_note";

export interface SessionEvent {
  seq: number;
  timestamp: string;
  type: SessionEventType;
  payload: Record<string, unknown>;
}

const logs = new Map<string, SessionEventLog>();

export class SessionEventLog {
  private sequence: number | null = null;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly agentDir: string,
    private readonly sessionId: string,
  ) {}

  get file(): string {
    return path.join(sessionDataDir(this.agentDir, this.sessionId), "events.jsonl");
  }

  append(type: SessionEventType, payload: Record<string, unknown>): Promise<SessionEvent> {
    const operation = this.pending.then(() => this.appendUnlocked(type, payload));
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  async readAll(maxEvents = 100_000): Promise<SessionEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return [];
    }
    const events: SessionEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as SessionEvent);
      } catch {
        // An incomplete final line is ignored; previous append-only records remain valid.
      }
      if (events.length >= maxEvents) break;
    }
    return events;
  }

  private async appendUnlocked(
    type: SessionEventType,
    payload: Record<string, unknown>,
  ): Promise<SessionEvent> {
    if (this.sequence === null) {
      const events = await this.readAll();
      this.sequence = events.reduce((max, event) => Math.max(max, event.seq), 0);
    }
    const event: SessionEvent = {
      seq: ++this.sequence,
      timestamp: new Date().toISOString(),
      type,
      payload,
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const handle = await fs.open(this.file, "a", 0o600);
    try {
      await handle.appendFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return event;
  }
}

export function sessionEventLog(agentDir: string, sessionId: string): SessionEventLog {
  const key = `${path.resolve(agentDir)}\0${sessionId}`;
  let log = logs.get(key);
  if (!log) {
    log = new SessionEventLog(agentDir, sessionId);
    logs.set(key, log);
  }
  return log;
}
