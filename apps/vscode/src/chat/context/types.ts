import type { CodebaseIndex } from "@ninjacode/tools";
import type { ContextQueryType, ContextSuggestion } from "../../protocol.js";

/** Everything a context provider may need, resolved lazily so a provider that
 * doesn't use the codebase index never pays for building it. */
export interface ContextEnv {
  /** Absolute path of the first workspace folder. */
  root: string;
  /** Built-on-demand semantic index (undefined when it fails to build). */
  index(): Promise<CodebaseIndex | undefined>;
  /** Most recently focused workspace-relative file paths, newest first. */
  recentFiles: readonly string[];
}

export interface ResolvedContext {
  /** Prompt-ready text block for this piece of context. */
  text: string;
  /** Display label, when the provider can produce a better one than the raw target. */
  label?: string;
}

/**
 * One source of attachable context. The `+` picker, `@` mentions, drag & drop and the
 * native "Add to chat" commands all go through this same interface, so adding a source
 * is a new file rather than a new branch in three different switches.
 */
export interface ContextProvider {
  readonly kind: ContextQueryType;
  /** Lightweight matches for the picker's search field. */
  suggest(query: string, env: ContextEnv): Promise<ContextSuggestion[]>;
  /** Expand one suggestion id into full text. */
  resolve(target: string, env: ContextEnv): Promise<ResolvedContext>;
}

export const MAX_SUGGESTIONS = 25;
