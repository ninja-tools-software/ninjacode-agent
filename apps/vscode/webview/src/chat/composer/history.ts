/**
 * Undo/redo for the composer.
 *
 * `document.execCommand("undo")` is the browser's own stack; it knows nothing
 * about badges inserted programmatically and happily resurrects half of one. So
 * the composer keeps its own stack of document snapshots. Consecutive typing is
 * coalesced into a single entry, the way a real editor does.
 */
import type { ComposerDoc } from "./model.js";
import { docEquals } from "./model.js";

export interface HistoryEntry {
  doc: ComposerDoc;
  caret: number;
}

/** Keystrokes closer than this are merged into the previous undo entry. */
const COALESCE_MS = 500;
const MAX_ENTRIES = 200;

export class ComposerHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private lastPushAt = 0;

  constructor(initial: HistoryEntry) {
    this.past.push(initial);
  }

  get current(): HistoryEntry {
    return this.past[this.past.length - 1]!;
  }

  get canUndo(): boolean {
    return this.past.length > 1;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Record a new state. `coalesce` merges into the previous entry when the edit
   * follows closely — typing a word is one undo step, inserting a badge is its own.
   */
  push(entry: HistoryEntry, coalesce = false, now = Date.now()): void {
    if (docEquals(this.current.doc, entry.doc)) {
      this.past[this.past.length - 1] = entry;
      return;
    }
    this.future = [];
    if (coalesce && now - this.lastPushAt < COALESCE_MS && this.past.length > 1) {
      this.past[this.past.length - 1] = entry;
    } else {
      this.past.push(entry);
      if (this.past.length > MAX_ENTRIES) this.past.shift();
    }
    this.lastPushAt = now;
  }

  /** Force the next `push` to start a fresh entry (e.g. after a badge insertion). */
  breakCoalescing(): void {
    this.lastPushAt = 0;
  }

  undo(): HistoryEntry | null {
    if (!this.canUndo) return null;
    this.future.push(this.past.pop()!);
    this.lastPushAt = 0;
    return this.current;
  }

  redo(): HistoryEntry | null {
    if (!this.canRedo) return null;
    this.past.push(this.future.pop()!);
    this.lastPushAt = 0;
    return this.current;
  }

  /** Drop the whole stack, e.g. when the session changes. */
  reset(entry: HistoryEntry): void {
    this.past = [entry];
    this.future = [];
    this.lastPushAt = 0;
  }
}
