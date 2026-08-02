import type { ToolContext } from "@ninjacode/tools";
import { collectDiagnostics, formatDiagnostics, type DiagnosticEntry } from "@ninjacode/tools";

export function isWriteTool(name: string): boolean {
  return name === "write_file" || name === "edit_file" || name === "apply_patch" || name === "delete_file";
}

export async function postEditDiagnostics(
  ctx: ToolContext,
  meta?: Record<string, unknown>,
): Promise<string | undefined> {
  const paths: string[] = [];
  if (typeof meta?.path === "string") paths.push(meta.path);
  if (Array.isArray(meta?.paths)) {
    for (const p of meta.paths) if (typeof p === "string") paths.push(p);
  }
  if (paths.length === 0) return undefined;

  const entries = await collectDiagnostics(ctx, paths);
  const errors = entries.filter((e: DiagnosticEntry) => e.severity === "error");
  const warnings = entries.filter((e: DiagnosticEntry) => e.severity === "warning");
  if (errors.length === 0 && warnings.length === 0) {
    return `[Post-edit diagnostics] No issues in ${paths.join(", ")}.`;
  }
  const formatted = formatDiagnostics([...errors, ...warnings]);
  return `[Post-edit diagnostics]\n${formatted}`;
}
