import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Tool } from "./types.js";
import { ToolError } from "./types.js";

export const MAX_SESSION_ARTIFACT_BYTES = 8 * 1024 * 1024;
const DEFAULT_PAGE_CHARS = 6_000;
const MAX_PAGE_CHARS = 8_000;
const ARTIFACT_ID = /^[a-f0-9]{64}$/;

export interface SessionArtifactMeta {
  id: string;
  sha256: string;
  byteLength: number;
  mimeType: string;
  kind: "tool_output" | "compaction_segment" | "legacy_observation" | "mcp_output";
  createdAt: string;
  toolName?: string;
  toolCallId?: string;
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function sessionDataDir(agentDir: string, sessionId: string): string {
  return path.join(agentDir, "sessions", safeSessionId(sessionId));
}

export function sessionArtifactsDir(agentDir: string, sessionId: string): string {
  return path.join(sessionDataDir(agentDir, sessionId), "artifacts");
}

export function sessionArtifactPaths(
  agentDir: string,
  sessionId: string,
  artifactId: string,
): { body: string; meta: string } {
  if (!ARTIFACT_ID.test(artifactId)) throw new ToolError("Invalid artifact id", "invalid_args");
  const dir = sessionArtifactsDir(agentDir, sessionId);
  return {
    body: path.join(dir, `${artifactId}.bin`),
    meta: path.join(dir, `${artifactId}.json`),
  };
}

async function readVerifiedArtifact(
  agentDir: string,
  sessionId: string,
  artifactId: string,
): Promise<{ meta: SessionArtifactMeta; text: string }> {
  const files = sessionArtifactPaths(agentDir, sessionId, artifactId);
  let meta: SessionArtifactMeta;
  let bytes: Buffer;
  try {
    [meta, bytes] = await Promise.all([
      fs.readFile(files.meta, "utf8").then((raw) => JSON.parse(raw) as SessionArtifactMeta),
      fs.readFile(files.body),
    ]);
  } catch {
    throw new ToolError(`Artifact not found: ${artifactId}`, "not_found");
  }
  if (bytes.byteLength > MAX_SESSION_ARTIFACT_BYTES || bytes.byteLength !== meta.byteLength) {
    throw new ToolError("Artifact size verification failed", "runtime");
  }
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== artifactId || digest !== meta.sha256) {
    throw new ToolError("Artifact integrity verification failed", "runtime");
  }
  return { meta, text: bytes.toString("utf8") };
}

function searchPreview(text: string, query: string, limit: number): string {
  const needle = query.toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  const lines: string[] = [];
  let from = 0;
  while (lines.join("\n").length < limit) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    const start = Math.max(0, index - 120);
    const end = Math.min(text.length, index + query.length + 240);
    lines.push(`[offset ${index}] ${text.slice(start, end).replace(/\s+/g, " ")}`);
    from = index + Math.max(query.length, 1);
  }
  return lines.length ? lines.join("\n").slice(0, limit) : "No matches.";
}

export const readSessionArtifactTool: Tool = {
  name: "read_session_artifact",
  description:
    "Read or search an immutable output archived for the active session. Use the artifact id shown in a truncated or compacted observation.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      artifact_id: { type: "string" },
      offset: { type: "number", description: "Character offset (default 0)" },
      limit: { type: "number", description: "Characters to read (default 6000, max 8000)" },
      query: { type: "string", description: "Optional literal, case-insensitive search" },
    },
    required: ["artifact_id"],
  },
  target(args) {
    return String(args.artifact_id ?? "");
  },
  async execute(ctx, args) {
    if (!ctx.sessionId) throw new ToolError("No active session", "runtime");
    const artifactId = String(args.artifact_id ?? "");
    const { meta, text } = await readVerifiedArtifact(ctx.agentDir, ctx.sessionId, artifactId);
    const requested = typeof args.limit === "number" ? Math.floor(args.limit) : DEFAULT_PAGE_CHARS;
    const limit = Math.min(Math.max(requested, 1), MAX_PAGE_CHARS);
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const offset = Math.min(
      Math.max(typeof args.offset === "number" ? Math.floor(args.offset) : 0, 0),
      text.length,
    );
    const content = query ? searchPreview(text, query, limit) : text.slice(offset, offset + limit);
    return {
      output: [
        `artifact: ${artifactId}`,
        `mime: ${meta.mimeType}`,
        `chars: ${text.length}`,
        `range: ${offset}-${Math.min(offset + limit, text.length)}`,
        "",
        content,
      ].join("\n"),
      meta: { artifactId, offset, limit, totalChars: text.length, sha256: meta.sha256 },
    };
  },
};
