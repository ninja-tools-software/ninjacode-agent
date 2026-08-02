import type { SweBenchInstance } from "./types.js";

/** Stable prompt template for SWE-bench Lite instances. */
export function buildSweBenchPrompt(instance: SweBenchInstance): string {
  const hints =
    instance.hints_text && instance.hints_text.trim().length > 0
      ? `\n\n<hints>\n${instance.hints_text.trim()}\n</hints>`
      : "";

  return [
    "You are fixing a real GitHub issue in this repository.",
    "Implement a minimal correct fix in the source code.",
    "Do not modify or add test files unless the issue explicitly requires it.",
    "When done, stop — your changes will be captured as a git patch.",
    "",
    `<issue repo="${instance.repo}">`,
    instance.problem_statement.trim(),
    "</issue>",
    hints,
  ].join("\n");
}
