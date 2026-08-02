import type { ProposedEditsStore } from "../proposedEdits.js";

interface RecordAppliedEditsOpts {
  edits: ProposedEditsStore;
  sessionId: string;
  toolName: string;
  meta?: Record<string, unknown>;
  hadError?: boolean;
}

function recordFileEdit(
  edits: ProposedEditsStore,
  sessionId: string,
  meta: Record<string, unknown>,
): void {
  const rel = typeof meta.path === "string" ? meta.path : "";
  const before = typeof meta.before === "string" ? meta.before : "";
  const after = typeof meta.after === "string" ? meta.after : "";
  if (!rel || before === after) return;
  edits.set({
    path: rel,
    before,
    after,
    diff: typeof meta.diff === "string" ? meta.diff : undefined,
    sessionId,
    applied: true,
  });
}

function recordPatchEdits(
  edits: ProposedEditsStore,
  sessionId: string,
  meta: Record<string, unknown>,
): void {
  const fileChanges = meta.fileChanges;
  if (!fileChanges || typeof fileChanges !== "object") return;
  const diffs = meta.diffs as Record<string, string> | undefined;
  for (const [rel, change] of Object.entries(fileChanges)) {
    const c = change as { before?: string; after?: string };
    const before = typeof c.before === "string" ? c.before : "";
    const after = typeof c.after === "string" ? c.after : "";
    if (before === after) continue;
    edits.set({ path: rel, before, after, diff: diffs?.[rel], sessionId, applied: true });
  }
}

/** Record post-applied file diffs for the Changes panel (apply-first flow):
 * writes already hit disk, so what we track here is the diff for review. */
export function recordAppliedEditsFromTool(opts: RecordAppliedEditsOpts): void {
  const { edits, sessionId, toolName, meta, hadError } = opts;
  if (!meta || hadError) return;
  if (toolName === "write_file" || toolName === "edit_file") {
    recordFileEdit(edits, sessionId, meta);
    return;
  }
  if (toolName === "apply_patch") recordPatchEdits(edits, sessionId, meta);
}
