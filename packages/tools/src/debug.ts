import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { unifiedDiff } from "./patch.js";
import { resolveInWorkspace } from "./paths.js";
import { collectFiles } from "./walk.js";

export const DEBUG_TOOL_NAMES = [
  "record_hypotheses",
  "read_debug_logs",
  "clear_debug_logs",
  "cleanup_instrumentation",
] as const;

export type HypothesisStatus = "pending" | "confirmed" | "rejected" | "inconclusive";

export interface Hypothesis {
  id: string;
  description: string;
  status: HypothesisStatus;
}

export interface DebugLogEntry {
  timestamp: string;
  hypothesisId: string;
  location?: string;
  message?: string;
  data?: unknown;
}

const START_MARKERS = [
  "NINJACODE-DEBUG-START",
  "NINJACODE_DEBUG_START",
];
const END_MARKERS = [
  "NINJACODE-DEBUG-END",
  "NINJACODE_DEBUG_END",
];

function logFile(ctx: ToolContext): string {
  return path.join(ctx.agentDir, "debug.log");
}

function hypothesesFile(ctx: ToolContext): string {
  return path.join(ctx.agentDir, "hypotheses.json");
}

async function readNdjsonLogs(file: string): Promise<DebugLogEntry[]> {
  let raw = "";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const entries: DebugLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as DebugLogEntry);
    } catch {
      // skip
    }
  }
  return entries;
}

function summarizeByHypothesis(entries: DebugLogEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.hypothesisId] = (counts[e.hypothesisId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Strip all NINJACODE-DEBUG-START / END blocks from content.
 * Handles line-comment and block-comment styles on the marker lines.
 */
export function stripDebugInstrumentation(content: string): { cleaned: string; removedBlocks: number } {
  const lines = content.split("\n");
  const out: string[] = [];
  let removedBlocks = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const isStart = START_MARKERS.some((m) => line.includes(m));
    if (!isStart) {
      out.push(line);
      i++;
      continue;
    }
    // Skip until matching END (inclusive)
    let j = i + 1;
    let foundEnd = false;
    while (j < lines.length) {
      if (END_MARKERS.some((m) => lines[j]!.includes(m))) {
        foundEnd = true;
        j++;
        break;
      }
      j++;
    }
    if (foundEnd) {
      removedBlocks++;
      i = j;
    } else {
      // Unmatched start — keep the line to avoid data loss
      out.push(line);
      i++;
    }
  }
  return { cleaned: out.join("\n"), removedBlocks };
}

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
  ".vue",
  ".svelte",
]);

export const recordHypothesesTool: Tool = {
  name: "record_hypotheses",
  description:
    "Record or update the list of debug hypotheses (id, description, status). Call before instrumentation and after analyzing logs.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      hypotheses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "e.g. H1" },
            description: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "confirmed", "rejected", "inconclusive"],
            },
          },
          required: ["id", "description"],
        },
      },
    },
    required: ["hypotheses"],
  },
  target() {
    return "hypotheses";
  },
  async execute(ctx, args): Promise<ToolResult> {
    const raw = args.hypotheses;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ToolError("hypotheses must be a non-empty array", "invalid_args");
    }
    const hypotheses: Hypothesis[] = raw.map((h, i) => {
      const obj = h as Record<string, unknown>;
      const id = String(obj.id ?? `H${i + 1}`);
      const description = String(obj.description ?? "");
      const status = (obj.status as HypothesisStatus) ?? "pending";
      if (!["pending", "confirmed", "rejected", "inconclusive"].includes(status)) {
        throw new ToolError(`Invalid status for ${id}: ${status}`, "invalid_args");
      }
      return { id, description, status };
    });
    await fs.mkdir(ctx.agentDir, { recursive: true });
    await fs.writeFile(
      hypothesesFile(ctx),
      JSON.stringify({ hypotheses }, null, 2),
      "utf8",
    );
    const summary = hypotheses
      .map((h) => `- [${h.status}] ${h.id}: ${h.description}`)
      .join("\n");
    return {
      output: `Recorded ${hypotheses.length} hypotheses:\n${summary}`,
      meta: { hypotheses },
    };
  },
};

export const readDebugLogsTool: Tool = {
  name: "read_debug_logs",
  description:
    "Read runtime debug logs collected during reproduction (.ninjacode/debug.log). Supports filtering by hypothesisId, since, limit, and tail.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      hypothesisId: { type: "string" },
      since: { type: "string", description: "ISO timestamp — only entries at or after this time" },
      limit: { type: "number", description: "Max entries to return from the start of the filtered set" },
      tail: { type: "number", description: "Return only the last N entries (applied before limit)" },
    },
  },
  target() {
    return "debug.log";
  },
  async execute(ctx, args): Promise<ToolResult> {
    let entries = await readNdjsonLogs(logFile(ctx));
    const hypothesisId =
      typeof args.hypothesisId === "string" ? args.hypothesisId : undefined;
    const since = typeof args.since === "string" ? args.since : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const tail = typeof args.tail === "number" ? args.tail : undefined;

    if (hypothesisId) {
      entries = entries.filter((e) => e.hypothesisId === hypothesisId);
    }
    if (since) {
      entries = entries.filter((e) => e.timestamp >= since);
    }
    if (tail && tail > 0) {
      entries = entries.slice(-tail);
    }
    if (limit && limit > 0) {
      entries = entries.slice(0, limit);
    }

    const byHypothesis = summarizeByHypothesis(entries);
    const preview = entries.slice(0, 80);
    return {
      output: JSON.stringify(
        {
          total: entries.length,
          byHypothesis,
          entries: preview,
          truncated: entries.length > preview.length,
        },
        null,
        2,
      ),
      meta: { total: entries.length, byHypothesis },
    };
  },
};

export const clearDebugLogsTool: Tool = {
  name: "clear_debug_logs",
  description: "Clear .ninjacode/debug.log before asking the user to reproduce the bug.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {},
  },
  target() {
    return "debug.log";
  },
  async execute(ctx): Promise<ToolResult> {
    await fs.mkdir(ctx.agentDir, { recursive: true });
    await fs.writeFile(logFile(ctx), "", "utf8");
    return { output: "Cleared debug.log", meta: { cleared: true } };
  },
};

export const cleanupInstrumentationTool: Tool = {
  name: "cleanup_instrumentation",
  description:
    "Remove all NINJACODE-DEBUG-START/END instrumentation blocks from the workspace (or from specific paths). Call after the user confirms the fix.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Optional relative paths to clean. If omitted, scan the workspace.",
      },
    },
  },
  target(args) {
    const paths = args.paths;
    if (Array.isArray(paths) && paths.length) return String(paths[0]);
    return "workspace";
  },
  async execute(ctx, args): Promise<ToolResult> {
    let files: string[] = [];
    if (Array.isArray(args.paths) && args.paths.length) {
      files = (args.paths as unknown[]).map((p) =>
        resolveInWorkspace(ctx.workspaceRoot, String(p)),
      );
    } else {
      files = await collectFiles(ctx.workspaceRoot, {
        extensions: SOURCE_EXTENSIONS,
        maxFiles: 5000,
        skipHidden: true,
      });
    }

    const cleanedFiles: Array<{ path: string; removedBlocks: number; diff?: string }> = [];
    for (const abs of files) {
      let content: string;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      if (!START_MARKERS.some((m) => content.includes(m))) continue;
      const { cleaned, removedBlocks } = stripDebugInstrumentation(content);
      if (removedBlocks === 0 || cleaned === content) continue;
      const rel = path.relative(ctx.workspaceRoot, abs);
      const diff = unifiedDiff(rel, content, cleaned);
      await fs.writeFile(abs, cleaned, "utf8");
      cleanedFiles.push({ path: rel, removedBlocks, diff });
    }

    if (cleanedFiles.length === 0) {
      return {
        output: "No instrumentation blocks found.",
        meta: { cleaned: [] },
      };
    }

    const summary = cleanedFiles
      .map((f) => `- ${f.path}: removed ${f.removedBlocks} block(s)`)
      .join("\n");
    return {
      output: `Cleaned ${cleanedFiles.length} file(s):\n${summary}`,
      meta: {
        cleaned: cleanedFiles.map((f) => f.path),
        files: cleanedFiles,
        // Surface first diff for review UI if present
        path: cleanedFiles[0]?.path,
        diff: cleanedFiles[0]?.diff,
        action: "cleanup_instrumentation",
      },
    };
  },
};
