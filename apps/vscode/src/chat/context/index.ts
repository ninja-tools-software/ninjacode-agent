import type {
  ContextQueryType,
  ContextSuggestion,
  RefKind,
} from "../../protocol.js";
import { codebaseProvider, fileProvider, openTabProvider, recentProvider } from "./files.js";
import { diagnosticsProvider } from "./diagnostics.js";
import { folderProvider } from "./folders.js";
import { scmDiffProvider } from "./scmDiff.js";
import { symbolProvider } from "./symbols.js";
import { urlProvider } from "./url.js";
import type { ContextEnv, ContextProvider, ResolvedContext } from "./types.js";

export type { ContextEnv } from "./types.js";
export { WORKING_TREE_TARGET } from "./scmDiff.js";

/** Every searchable context source, keyed by the kind the picker sends. */
const PROVIDERS: Record<ContextQueryType, ContextProvider> = {
  file: fileProvider,
  folder: folderProvider,
  symbol: symbolProvider,
  open_tab: openTabProvider,
  recent: recentProvider,
  diagnostics: diagnosticsProvider,
  scm_diff: scmDiffProvider,
  codebase: codebaseProvider,
  url: urlProvider,
};

/** Ref kinds that are resolved by a searchable provider (the rest carry their own payload). */
export function providerForRefKind(kind: RefKind): ContextProvider | undefined {
  return (PROVIDERS as Partial<Record<RefKind, ContextProvider>>)[kind];
}

/** Suggestions for the picker. Never throws — a failing source yields no matches. */
export async function suggestContext(
  kind: ContextQueryType,
  query: string,
  env: ContextEnv,
): Promise<ContextSuggestion[]> {
  try {
    return await PROVIDERS[kind].suggest(query, env);
  } catch {
    return [];
  }
}

/** Resolve one context target to prompt text. Never throws — failures become a visible note. */
export async function resolveContext(
  kind: ContextQueryType,
  target: string,
  env: ContextEnv,
): Promise<ResolvedContext> {
  try {
    return await PROVIDERS[kind].resolve(target, env);
  } catch (e) {
    return { text: `[Could not resolve ${kind} "${target}": ${(e as Error).message}]` };
  }
}
