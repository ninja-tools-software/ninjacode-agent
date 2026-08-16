import type { Message } from "@ninjacode/providers";
import { compactHistory } from "./context.js";
import { estimateTokens } from "./contextEstimate.js";
import { discoverRules } from "./rules.js";

const SCOPED_RULES_MARKER = "[Scoped project rules for active/touched files]";

type CompactHistoryOptions = Parameters<typeof compactHistory>[0];

export type ContextViewOptions = CompactHistoryOptions & {
  workspaceRoot?: string;
  /** Workspace-relative files known to be active or touched by the current run. */
  activeFiles?: readonly string[];
};

/**
 * Builds the bounded model-facing view. The append-only event log and artifact
 * store remain canonical; reductions performed here never mutate those sources.
 */
export async function buildContextView(options: ContextViewOptions) {
  const { workspaceRoot, activeFiles, ...compaction } = options;
  const rules = workspaceRoot ? await loadScopedRules(workspaceRoot, activeFiles) : undefined;
  const history = removeScopedRules(options.history);
  const rulesMessage = rules ? scopedRulesMessage(rules) : undefined;
  const rulesTokens = rulesMessage
    ? estimateTokens([rulesMessage], options.budgetModel ?? options.model)
    : 0;
  const compacted = await compactHistory({
    ...compaction,
    history,
    systemTokens: (options.systemTokens ?? 0) + rulesTokens,
  });
  const messages = rulesMessage ? injectBeforeLatestUser(compacted.messages, rulesMessage) : compacted.messages;
  return {
    messages,
    changed: compacted.changed || !sameMessages(options.history, messages),
  };
}

async function loadScopedRules(
  workspaceRoot: string,
  activeFiles?: readonly string[],
): Promise<string> {
  try {
    return (
      await discoverRules(workspaceRoot, {
        activeFiles,
        scopedOnly: true,
      })
    ).text;
  } catch {
    // A failed discovery must not retain stale scoped instructions.
    return "";
  }
}

function scopedRulesMessage(rules: string): Message {
  return {
    role: "user",
    content: `${SCOPED_RULES_MARKER}\n${rules}`,
  };
}

function removeScopedRules(history: Message[]): Message[] {
  return history.filter((message) => !message.content.startsWith(SCOPED_RULES_MARKER));
}

function injectBeforeLatestUser(history: Message[], rules: Message): Message[] {
  let index = history.length - 1;
  while (index >= 0 && history[index]?.role !== "user") index -= 1;
  if (index < 0) return [...history, rules];
  return [...history.slice(0, index), rules, ...history.slice(index)];
}

function sameMessages(before: Message[], after: Message[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((message, index) => JSON.stringify(message) === JSON.stringify(after[index]));
}
