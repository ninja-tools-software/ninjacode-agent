import { describe, expect, it } from "vitest";
import type { ModelInfo, SettingsState } from "../../types.js";
import {
  budgetEffortLabels,
  capitalizeEffort,
  defaultContextWindow,
  defaultReasoningEffort,
  effectiveContextWindow,
  formatModelSettingsSummary,
  isDefaultContextSelected,
  labelForBudgetOption,
} from "./modelMenuHelpers.js";

const levelsModel: ModelInfo = {
  id: "gpt",
  label: "GPT",
  contextWindow: 1_000_000,
  defaultContextWindow: 200_000,
  maxOutput: 16_384,
  reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
};

const budgetModel: ModelInfo = {
  id: "claude",
  label: "Claude",
  contextWindow: 200_000,
  maxOutput: 64_000,
  reasoning: { kind: "budget", min: 1_024, max: 64_000, default: 10_000 },
};

function settings(partial: Partial<SettingsState> = {}): SettingsState {
  return {
    provider: "gateway",
    providers: ["gateway"],
    model: "gpt",
    baseUrl: "",
    baseUrls: {},
    chatLocation: "primary",
    chatSide: "left",
    primarySidebarSide: "left",
    mode: "agent",
    approvalMode: "balanced",
    reasoningEffort: "medium",
    thinkingBudgetTokens: 10_000,
    contextWindow: 0,
    catalogs: [],
    providerLabels: {},
    models: [levelsModel],
    favoriteModels: [],
    modelSort: "cost-desc",
    contextPresets: [32_000, 64_000, 128_000, 200_000, 1_000_000],
    hasApiKey: {},
    account: null,
    usage: [],
    plans: null,
    gatewayConfigured: true,
    locale: "en",
    localeSetting: "auto",
    ...partial,
  };
}

describe("model settings defaults", () => {
  it("reads per-model reasoning and context defaults", () => {
    expect(defaultReasoningEffort(levelsModel)).toBe("medium");
    expect(defaultContextWindow(levelsModel)).toBe(200_000);
    expect(defaultContextWindow(budgetModel)).toBe(200_000);
  });

  it("treats contextWindow 0 as the model default", () => {
    expect(effectiveContextWindow(settings(), levelsModel)).toBe(200_000);
    expect(isDefaultContextSelected(settings(), levelsModel)).toBe(true);
    expect(isDefaultContextSelected(settings({ contextWindow: 200_000 }), levelsModel)).toBe(true);
    expect(isDefaultContextSelected(settings({ contextWindow: 1_000_000 }), levelsModel)).toBe(false);
  });

  it("formats the settings pill summary", () => {
    expect(capitalizeEffort("high")).toBe("High");
    expect(capitalizeEffort("xhigh")).toBe("Extra High");
    expect(formatModelSettingsSummary(settings({ reasoningEffort: "high" }), levelsModel)).toBe(
      "High 200K",
    );
    expect(
      formatModelSettingsSummary(
        settings({ contextWindow: 1_000_000, thinkingBudgetTokens: 10_000 }),
        budgetModel,
      ),
    ).toBe("Medium 1M");
  });
});

describe("budgetEffortLabels", () => {
  it("centers a subset of the Very Low…MAX scale", () => {
    expect(budgetEffortLabels(4)).toEqual(["Low", "Medium", "High", "Very High"]);
    expect(budgetEffortLabels(5)).toEqual(["Very Low", "Low", "Medium", "High", "Very High"]);
    expect(budgetEffortLabels(6)).toEqual([
      "Very Low",
      "Low",
      "Medium",
      "High",
      "Very High",
      "MAX",
    ]);
    expect(budgetEffortLabels(3)).toEqual(["Low", "Medium", "High"]);
    expect(budgetEffortLabels(1)).toEqual(["Medium"]);
  });

  it("maps token budgets to centered labels", () => {
    const options = [1024, 5500, 10_000, 37_000, 64_000];
    expect(labelForBudgetOption(options, 1024)).toBe("Very Low");
    expect(labelForBudgetOption(options, 10_000)).toBe("Medium");
    expect(labelForBudgetOption(options, 64_000)).toBe("Very High");
  });
});
