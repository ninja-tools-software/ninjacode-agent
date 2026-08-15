import { compactHistory } from "./context.js";

export type ContextViewOptions = Parameters<typeof compactHistory>[0];

/**
 * Builds the bounded model-facing view. The append-only event log and artifact
 * store remain canonical; reductions performed here never mutate those sources.
 */
export async function buildContextView(options: ContextViewOptions) {
  return compactHistory(options);
}
