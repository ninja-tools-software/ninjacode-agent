/**
 * Per-session composer drafts, persisted in the webview's own state so a message
 * being written survives a session switch or a panel reload.
 */
import { EMPTY_DOC, fromDraft, isEmpty, toDraft, type ComposerDoc } from "../composer/model.js";
import type { ComposerNode } from "../types.js";

/** Sessions without a draft cost nothing; this only bounds pathological growth. */
const MAX_DRAFTS = 50;

/** Key used for messages typed before any session exists. */
export const NEW_SESSION_KEY = "__new__";

interface DraftStore {
  drafts: Record<string, { nodes: ComposerNode[] }>;
  /** Most recent first, so trimming drops the stalest draft. */
  order: string[];
}

export const EMPTY_STORE: DraftStore = { drafts: {}, order: [] };

export function loadDrafts(raw: unknown): DraftStore {
  if (!raw || typeof raw !== "object") return EMPTY_STORE;
  const candidate = (raw as { composerDrafts?: unknown }).composerDrafts;
  if (!candidate || typeof candidate !== "object") return EMPTY_STORE;
  const { drafts, order } = candidate as Partial<DraftStore>;
  if (!drafts || typeof drafts !== "object") return EMPTY_STORE;
  return {
    drafts: drafts as DraftStore["drafts"],
    order: Array.isArray(order) ? order.filter((id) => typeof id === "string") : Object.keys(drafts),
  };
}

/** Merge the store back into whatever else the webview keeps in its state. */
export function withDrafts(previousState: unknown, store: DraftStore): Record<string, unknown> {
  const base = previousState && typeof previousState === "object" ? { ...previousState } : {};
  return { ...base, composerDrafts: store };
}

export function readDraft(store: DraftStore, sessionId: string | undefined): ComposerDoc {
  const key = sessionId ?? NEW_SESSION_KEY;
  const entry = store.drafts[key];
  return entry ? fromDraft(entry) : EMPTY_DOC;
}

/** Store (or clear, when empty) the draft for one session. */
export function writeDraft(
  store: DraftStore,
  sessionId: string | undefined,
  doc: ComposerDoc,
): DraftStore {
  const key = sessionId ?? NEW_SESSION_KEY;
  const drafts = { ...store.drafts };
  let order = store.order.filter((id) => id !== key);

  if (isEmpty(doc) && doc.nodes.every((n) => n.kind === "text")) {
    delete drafts[key];
  } else {
    drafts[key] = toDraft(doc);
    order = [key, ...order];
  }

  while (order.length > MAX_DRAFTS) {
    const dropped = order.pop();
    if (dropped) delete drafts[dropped];
  }
  return { drafts, order };
}

export function clearDraft(store: DraftStore, sessionId: string | undefined): DraftStore {
  return writeDraft(store, sessionId, EMPTY_DOC);
}
