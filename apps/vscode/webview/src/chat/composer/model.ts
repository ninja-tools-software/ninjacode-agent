/**
 * The composer document: a flat sequence of text runs and atomic context badges.
 *
 * Everything here is pure and DOM-free. Positions are **logical offsets**: a text
 * run contributes one offset per character, a badge contributes exactly one (it is
 * atomic — the caret can sit before or after it, never inside). `dom.ts` is the only
 * place that maps these offsets to and from DOM selections.
 */
import type { ComposerNode, ContextRef } from "../types.js";

export interface ComposerDoc {
  nodes: ComposerNode[];
}

export const EMPTY_DOC: ComposerDoc = { nodes: [] };

export function docFromText(text: string): ComposerDoc {
  return normalize({ nodes: text ? [{ kind: "text", text }] : [] });
}

function nodeLength(node: ComposerNode): number {
  return node.kind === "text" ? node.text.length : 1;
}

export function docLength(doc: ComposerDoc): number {
  return doc.nodes.reduce((n, node) => n + nodeLength(node), 0);
}

export function isEmpty(doc: ComposerDoc): boolean {
  return doc.nodes.every((n) => (n.kind === "text" ? n.text.length === 0 : false));
}

/** Merge adjacent text runs and drop empty ones, so equal documents compare equal. */
export function normalize(doc: ComposerDoc): ComposerDoc {
  const nodes: ComposerNode[] = [];
  for (const node of doc.nodes) {
    if (node.kind === "text") {
      if (!node.text) continue;
      const last = nodes[nodes.length - 1];
      if (last?.kind === "text") {
        nodes[nodes.length - 1] = { kind: "text", text: last.text + node.text };
        continue;
      }
    }
    nodes.push(node);
  }
  return { nodes };
}

/** Plain text with badges rendered as a single placeholder character. */
const BADGE_PLACEHOLDER = "\u2063";

/** Text as the caret sees it: one placeholder char per badge keeps offsets aligned. */
export function docToOffsetText(doc: ComposerDoc): string {
  return doc.nodes.map((n) => (n.kind === "text" ? n.text : BADGE_PLACEHOLDER)).join("");
}

/** Only the literal text the user typed, with badges removed. */
export function docToText(doc: ComposerDoc): string {
  return doc.nodes
    .map((n) => (n.kind === "text" ? n.text : ""))
    .join("")
    .trim();
}

export function refsOf(doc: ComposerDoc): ContextRef[] {
  const seen = new Set<string>();
  const out: ContextRef[] = [];
  for (const node of doc.nodes) {
    if (node.kind !== "ref" || seen.has(node.ref.id)) continue;
    seen.add(node.ref.id);
    out.push(node.ref);
  }
  return out;
}

interface Position {
  /** Index into `doc.nodes`, or `doc.nodes.length` when past the end. */
  index: number;
  /** Offset inside that node (always 0 for badges). */
  inner: number;
}

/** Locate a logical offset. Offsets that land inside a badge snap to its start. */
export function locate(doc: ComposerDoc, offset: number): Position {
  let remaining = Math.max(0, offset);
  for (let index = 0; index < doc.nodes.length; index++) {
    const len = nodeLength(doc.nodes[index]!);
    if (remaining < len) return { index, inner: doc.nodes[index]!.kind === "text" ? remaining : 0 };
    remaining -= len;
  }
  return { index: doc.nodes.length, inner: 0 };
}

/** Logical offset of the start of `index`. */
export function offsetOfNode(doc: ComposerDoc, index: number): number {
  let offset = 0;
  for (let i = 0; i < index && i < doc.nodes.length; i++) offset += nodeLength(doc.nodes[i]!);
  return offset;
}

export function clampOffset(doc: ComposerDoc, offset: number): number {
  return Math.max(0, Math.min(docLength(doc), offset));
}

/** Split the document at a logical offset, snapping to badge boundaries. */
function splitAt(doc: ComposerDoc, offset: number): { before: ComposerNode[]; after: ComposerNode[] } {
  const target = clampOffset(doc, offset);
  const before: ComposerNode[] = [];
  const after: ComposerNode[] = [];
  let seen = 0;
  for (const node of doc.nodes) {
    const len = nodeLength(node);
    if (seen + len <= target) {
      before.push(node);
    } else if (seen >= target) {
      after.push(node);
    } else if (node.kind === "text") {
      const cut = target - seen;
      before.push({ kind: "text", text: node.text.slice(0, cut) });
      after.push({ kind: "text", text: node.text.slice(cut) });
    } else {
      // Offset fell inside an atomic badge: keep it whole, on the right side.
      after.push(node);
    }
    seen += len;
  }
  return { before, after };
}

export interface EditResult {
  doc: ComposerDoc;
  /** Where the caret should land after the edit. */
  caret: number;
}

export function insertText(doc: ComposerDoc, offset: number, text: string): EditResult {
  if (!text) return { doc, caret: clampOffset(doc, offset) };
  const at = clampOffset(doc, offset);
  const { before, after } = splitAt(doc, at);
  return {
    doc: normalize({ nodes: [...before, { kind: "text", text }, ...after] }),
    caret: at + text.length,
  };
}

/**
 * Insert badges at `offset`. Refs already present are moved rather than
 * duplicated, so dropping the same file twice keeps a single badge.
 */
export function insertRefs(doc: ComposerDoc, offset: number, refs: readonly ContextRef[]): EditResult {
  if (refs.length === 0) return { doc, caret: clampOffset(doc, offset) };

  const incoming = new Set(refs.map((r) => r.id));
  let base = doc;
  let at = clampOffset(doc, offset);
  for (;;) {
    const index = base.nodes.findIndex((n) => n.kind === "ref" && incoming.has(n.ref.id));
    if (index === -1) break;
    if (offsetOfNode(base, index) < at) at -= 1;
    base = normalize({ nodes: base.nodes.filter((_, i) => i !== index) });
  }

  const { before, after } = splitAt(base, at);
  const inserted: ComposerNode[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    inserted.push({ kind: "ref", ref });
  }
  // A trailing space keeps typing natural right after a badge.
  const tail = after[0]?.kind === "text" && after[0].text.startsWith(" ") ? [] : [{ kind: "text" as const, text: " " }];
  return {
    doc: normalize({ nodes: [...before, ...inserted, ...tail, ...after] }),
    caret: at + inserted.length + tail.length,
  };
}

export function deleteRange(doc: ComposerDoc, start: number, end: number): EditResult {
  const from = clampOffset(doc, Math.min(start, end));
  const to = clampOffset(doc, Math.max(start, end));
  if (from === to) return { doc, caret: from };
  const head = splitAt(doc, from).before;
  const tail = splitAt(doc, to).after;
  return { doc: normalize({ nodes: [...head, ...tail] }), caret: from };
}

/** Backspace: removes the whole badge when the caret sits right after one. */
export function deleteBackward(doc: ComposerDoc, caret: number): EditResult {
  const at = clampOffset(doc, caret);
  if (at === 0) return { doc, caret: 0 };
  return deleteRange(doc, at - 1, at);
}

export function deleteForward(doc: ComposerDoc, caret: number): EditResult {
  const at = clampOffset(doc, caret);
  if (at >= docLength(doc)) return { doc, caret: at };
  return deleteRange(doc, at, at + 1);
}

export function removeRef(doc: ComposerDoc, refId: string): ComposerDoc {
  return normalize({ nodes: doc.nodes.filter((n) => n.kind !== "ref" || n.ref.id !== refId) });
}

/** Replace badges in place, e.g. when the host reports their resolved token counts. */
export function updateRefs(doc: ComposerDoc, refs: readonly ContextRef[]): ComposerDoc {
  const byId = new Map(refs.map((r) => [r.id, r]));
  return {
    nodes: doc.nodes.map((n) =>
      n.kind === "ref" && byId.has(n.ref.id) ? { kind: "ref", ref: byId.get(n.ref.id)! } : n,
    ),
  };
}

/** Move an existing badge to a new logical offset (internal drag & drop). */
export function moveRef(doc: ComposerDoc, refId: string, offset: number): EditResult {
  const node = doc.nodes.find((n) => n.kind === "ref" && n.ref.id === refId);
  if (!node || node.kind !== "ref") return { doc, caret: clampOffset(doc, offset) };
  return insertRefs(doc, offset, [node.ref]);
}

/** The word being typed right before the caret, for `@` and `/` autocompletion. */
export function textBeforeCaret(doc: ComposerDoc, caret: number): string {
  const at = clampOffset(doc, caret);
  let out = "";
  let seen = 0;
  for (const node of doc.nodes) {
    const len = nodeLength(node);
    if (seen >= at) break;
    if (node.kind === "text") {
      out += node.text.slice(0, Math.max(0, Math.min(len, at - seen)));
    } else {
      out = "";
    }
    seen += len;
  }
  return out;
}

/** Replace the `@query` / `/query` token that ends at the caret. */
export function replaceTokenBeforeCaret(
  doc: ComposerDoc,
  caret: number,
  tokenLength: number,
  replacement: string,
): EditResult {
  const at = clampOffset(doc, caret);
  const cleared = deleteRange(doc, at - tokenLength, at);
  return insertText(cleared.doc, cleared.caret, replacement);
}

/** Insert badges in place of the `@query` token that triggered the picker. */
export function replaceTokenWithRefs(
  doc: ComposerDoc,
  caret: number,
  tokenLength: number,
  refs: readonly ContextRef[],
): EditResult {
  const at = clampOffset(doc, caret);
  const cleared = deleteRange(doc, at - tokenLength, at);
  return insertRefs(cleared.doc, cleared.caret, refs);
}

export function docEquals(a: ComposerDoc, b: ComposerDoc): boolean {
  if (a.nodes.length !== b.nodes.length) return false;
  return a.nodes.every((node, i) => {
    const other = b.nodes[i]!;
    if (node.kind !== other.kind) return false;
    if (node.kind === "text" && other.kind === "text") return node.text === other.text;
    if (node.kind === "ref" && other.kind === "ref") return node.ref.id === other.ref.id;
    return false;
  });
}

/** Serializable snapshot, used to persist the draft per session. */
interface ComposerDraft {
  nodes: ComposerNode[];
}

export function toDraft(doc: ComposerDoc): ComposerDraft {
  return { nodes: doc.nodes };
}

export function fromDraft(draft: unknown): ComposerDoc {
  if (!draft || typeof draft !== "object") return EMPTY_DOC;
  const nodes = (draft as ComposerDraft).nodes;
  if (!Array.isArray(nodes)) return EMPTY_DOC;
  const safe = nodes.filter(
    (n): n is ComposerNode =>
      Boolean(n) &&
      ((n.kind === "text" && typeof n.text === "string") ||
        (n.kind === "ref" && Boolean(n.ref) && typeof n.ref.id === "string")),
  );
  return normalize({ nodes: safe });
}
