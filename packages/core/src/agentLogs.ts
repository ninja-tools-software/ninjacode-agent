/**
 * Redacted, truncated debug-log channel for agent internals (LLM calls, tool
 * calls, cache stats, cancellations). Intended for a host-side "Agent Logs" /
 * "Show Agent Debug Logs" panel — never includes API keys or full prompts.
 */
export type AgentLogEventType =
  | "llm_call"
  | "llm_response"
  | "tool_call"
  | "tool_result"
  | "cache"
  | "cancel"
  | "error";

export interface AgentLogEntry {
  timestamp: string;
  sessionId: string;
  type: AgentLogEventType;
  /** Short, single-line, redacted summary — always safe to show in a compact list. */
  summary: string;
  /** Optional longer, redacted+truncated detail. */
  detail?: string;
  meta?: Record<string, unknown>;
}

const MAX_SUMMARY = 300;
const MAX_DETAIL = 2000;
const MAX_ENTRIES = 500;

// Order matters: more specific patterns first so a key=value pair isn't
// double-redacted by a broader bearer-token pattern, etc.
const REDACT_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\banthropic-[A-Za-z0-9_-]{10,}/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g,
  /("?(?:api[_-]?key|apikey|secret|token|password|authorization)"?\s*[:=]\s*")([^"]{2})[^"]*(")/gi,
  /('(?:api[_-]?key|apikey|secret|token|password|authorization)'\s*[:=]\s*')([^']{2})[^']*(')/gi,
];

/** Best-effort redaction of common API key / secret shapes from free-form text. */
export function redact(text: string): string {
  let out = text;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, (_match, ...groups) => {
      if (groups.length >= 3 && typeof groups[0] === "string") {
        // key="ab..." style match — keep the wrapper, mask the value.
        return `${groups[0]}${groups[1]}***REDACTED***${groups[2]}`;
      }
      return "***REDACTED***";
    });
  }
  return out;
}

export function truncateForLog(text: string, max: number = MAX_DETAIL): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}

function sanitize(text: string, max: number): string {
  return redact(truncateForLog(text, max));
}

/**
 * Bounded in-memory ring buffer of redacted log entries, optionally mirrored
 * live via `onEntry` (e.g. to stream into a VS Code output channel or webview).
 */
export class AgentLogChannel {
  private entries: AgentLogEntry[] = [];

  constructor(private readonly onEntry?: (entry: AgentLogEntry) => void) {}

  log(opts: {
    sessionId: string;
    type: AgentLogEventType;
    summary: string;
    detail?: string;
    meta?: Record<string, unknown>;
  }): AgentLogEntry {
    const entry: AgentLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: opts.sessionId,
      type: opts.type,
      summary: sanitize(opts.summary, MAX_SUMMARY),
      detail: opts.detail ? sanitize(opts.detail, MAX_DETAIL) : undefined,
      meta: opts.meta,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.onEntry?.(entry);
    return entry;
  }

  list(sessionId?: string): AgentLogEntry[] {
    const all = sessionId ? this.entries.filter((e) => e.sessionId === sessionId) : this.entries;
    return all.map((e) => ({ ...e }));
  }

  clear(): void {
    this.entries = [];
  }
}
