const NON_CHAT_PATTERNS = [
  /text-embedding/i,
  /\bembedding\b/i,
  /whisper/i,
  /\btts\b/i,
  /dall-e/i,
  /image/i,
  /moderation/i,
  /rerank/i,
];

/**
 * Whether an upstream model id looks like a chat/completion model worth
 * proposing as a route. Filters out embeddings, audio/image models, and
 * OpenRouter's dynamically-priced meta-routers (`openrouter/auto*`).
 */
export function isChatCompletionModel(upstreamModel: string): boolean {
  if (/^openrouter\/(auto|fusion|pareto|bodybuilder)/i.test(upstreamModel)) return false;
  return !NON_CHAT_PATTERNS.some((pattern) => pattern.test(upstreamModel));
}
