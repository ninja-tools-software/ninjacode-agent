import { formatContext } from "../format.js";
import type { ModelInfo, SettingsState } from "../types.js";

type Effort = SettingsState["reasoningEffort"];

/**
 * Display labels for token-budget thinking controls. When a subset is shown,
 * pick a centered window (e.g. 4 options → Low…Very High).
 */
export const BUDGET_EFFORT_SCALE = [
  "Very Low",
  "Low",
  "Medium",
  "High",
  "Very High",
  "MAX",
] as const;

/** Center `count` labels from {@link BUDGET_EFFORT_SCALE}. */
export function budgetEffortLabels(count: number): string[] {
  if (count <= 0) return [];
  if (count >= BUDGET_EFFORT_SCALE.length) return [...BUDGET_EFFORT_SCALE];
  const start = Math.floor((BUDGET_EFFORT_SCALE.length - count) / 2);
  return BUDGET_EFFORT_SCALE.slice(start, start + count);
}

/** Five evenly spread choices across the model's thinking-budget range. */
export function budgetOptions(modelInfo?: ModelInfo): number[] {
  if (modelInfo?.reasoning?.kind !== "budget") return [];
  const { min, max, default: def } = modelInfo.reasoning;
  return [min, Math.round((min + def) / 2), def, Math.round((def + max) / 2), max].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
}

/** Human label for a token budget among the model's option list. */
export function labelForBudgetOption(options: number[], value: number): string {
  const index = options.indexOf(value);
  if (index < 0) return formatContextSizeLabel(value);
  return budgetEffortLabels(options.length)[index] ?? formatContextSizeLabel(value);
}

export function orderModels(models: ModelInfo[], favorites: string[]): ModelInfo[] {
  if (favorites.length === 0) return models;
  const starred = new Set(favorites);
  return [...models.filter((m) => starred.has(m.id)), ...models.filter((m) => !starred.has(m.id))];
}

export function defaultReasoningEffort(modelInfo?: ModelInfo): Effort {
  if (modelInfo?.reasoning?.kind === "levels") {
    const def = modelInfo.reasoning.default ?? "medium";
    return modelInfo.reasoning.levels.includes(def) ? def : (modelInfo.reasoning.levels[0] ?? "medium");
  }
  return "medium";
}

export function defaultThinkingBudget(modelInfo?: ModelInfo): number | undefined {
  if (modelInfo?.reasoning?.kind !== "budget") return undefined;
  return modelInfo.reasoning.default;
}

/** Model's recommended context size for the Default label. */
export function defaultContextWindow(modelInfo?: ModelInfo): number {
  return modelInfo?.defaultContextWindow ?? modelInfo?.contextWindow ?? 0;
}

export function effectiveContextWindow(settings: SettingsState, modelInfo?: ModelInfo): number {
  if (settings.contextWindow > 0) return settings.contextWindow;
  return defaultContextWindow(modelInfo) || settings.contextPresets.at(-1) || 0;
}

export function capitalizeEffort(effort: string): string {
  if (!effort) return effort;
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function formatContextSizeLabel(n: number): string {
  return formatContext(n).replace(/k$/i, "K").replace(/m$/i, "M");
}

/** Parts for the settings pill — `effort` is an English l10n key when present. */
export function modelSettingsSummaryParts(
  settings: SettingsState,
  modelInfo?: ModelInfo,
): { effort?: string; context: string } {
  const context = formatContextSizeLabel(effectiveContextWindow(settings, modelInfo));
  const reasoning = modelInfo?.reasoning;
  if (reasoning?.kind === "levels") {
    const effort = settings.reasoningEffort || defaultReasoningEffort(modelInfo);
    return { effort: capitalizeEffort(effort), context };
  }
  if (reasoning?.kind === "budget") {
    const options = budgetOptions(modelInfo);
    const budget =
      settings.thinkingBudgetTokens || defaultThinkingBudget(modelInfo) || reasoning.default;
    return { effort: labelForBudgetOption(options, budget), context };
  }
  return { context };
}

/** Compact summary for the settings pill, e.g. "High 200K". */
export function formatModelSettingsSummary(
  settings: SettingsState,
  modelInfo?: ModelInfo,
): string {
  const { effort, context } = modelSettingsSummaryParts(settings, modelInfo);
  return effort ? `${effort} ${context}` : context;
}

export function isDefaultContextSelected(settings: SettingsState, modelInfo?: ModelInfo): boolean {
  if (settings.contextWindow === 0) return true;
  const def = defaultContextWindow(modelInfo);
  return def > 0 && settings.contextWindow === def;
}
