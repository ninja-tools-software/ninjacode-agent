/**
 * Truncate tool output for the model. The marker matters: a silent cut makes the
 * model believe it saw everything, so it never asks for the rest.
 */
export function truncateForModel(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}
