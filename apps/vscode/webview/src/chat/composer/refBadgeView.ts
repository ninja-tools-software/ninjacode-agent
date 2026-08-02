/**
 * Presentation rules for a context badge, shared by the React badge (history,
 * chips) and the imperative one built inside the contenteditable composer.
 */
import { formatTokens } from "../format.js";
import type { ContextRef, RefKind } from "../types.js";

/** 24x24 stroke paths, matching the icon set in `icons.tsx`. */
const ICON_PATHS: Record<RefKind, string[]> = {
  file: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z", "M14 2v6h6"],
  folder: ["M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"],
  symbol: ["M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3", "M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"],
  open_tab: ["M3 6h7l2 3h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  recent: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"],
  diagnostics: ["M12 3 2 21h20z", "M12 9v5", "M12 18h.01"],
  scm_diff: ["M6 3v12", "M18 9v12", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  codebase: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M21 21l-4.3-4.3"],
  url: ["M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1", "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"],
  selection: ["M4 4h6", "M4 4v6", "M20 20h-6", "M20 20v-6", "M8 12h8"],
  snippet: ["M8 6 3 12l5 6", "M16 6l5 6-5 6"],
  image: ["M3 5h18v14H3z", "M3 16l5-5 4 4 3-3 6 6", "M9 9h.01"],
  terminal: ["M4 17l6-5-6-5", "M12 19h8"],
};

export function refIconPaths(kind: RefKind): string[] {
  return ICON_PATHS[kind] ?? ICON_PATHS.file;
}

/** Short text inside the badge. */
export function refBadgeLabel(ref: ContextRef): string {
  if (ref.range) return `${ref.label}:${ref.range.start}-${ref.range.end}`;
  return ref.label;
}

/** Tooltip: full target, then resolution state and token cost. */
export function refBadgeTitle(ref: ContextRef): string {
  const parts = [ref.detail || ref.target];
  if (ref.status === "pending") parts.push("resolving…");
  if (ref.status === "error") parts.push(ref.error || "failed to resolve");
  if (ref.tokens) parts.push(`${formatTokens(ref.tokens)} tok`);
  return parts.filter(Boolean).join(" · ");
}

export function refBadgeClass(ref: ContextRef, extra?: string): string {
  return ["ref-badge", `ref-${ref.kind}`, `ref-status-${ref.status}`, extra].filter(Boolean).join(" ");
}

/** Total token cost of a set of refs, for the composer's context counter. */
export function totalRefTokens(refs: readonly ContextRef[]): number {
  return refs.reduce((sum, r) => sum + (r.tokens ?? 0), 0);
}
