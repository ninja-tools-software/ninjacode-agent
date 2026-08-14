import type { ModelInfo, ProviderKind } from "@ninjacode/providers";

export interface ContextWindowConfig {
  kind: ProviderKind;
  model?: string;
  contextWindow?: number;
}

type WindowModel = Pick<ModelInfo, "id" | "contextWindow" | "defaultContextWindow">;

export function resolveContextWindow(
  configuredWindow: number,
  modelInfo: Pick<ModelInfo, "contextWindow" | "defaultContextWindow"> | undefined,
): number | undefined {
  if (configuredWindow > 0) {
    return Math.min(configuredWindow, modelInfo?.contextWindow ?? configuredWindow);
  }
  return modelInfo?.defaultContextWindow ?? modelInfo?.contextWindow;
}

/** Fill contextWindow from a live gateway catalog when the static catalog missed the model. */
export function enrichRunConfigFromLiveModels<T extends ContextWindowConfig>(
  config: T,
  models: WindowModel[],
): T {
  if (config.kind !== "gateway" || config.contextWindow) return config;
  const modelInfo = models.find((m) => m.id === config.model);
  if (!modelInfo) return config;
  const contextWindow = resolveContextWindow(0, modelInfo);
  if (!contextWindow) return config;
  return { ...config, contextWindow };
}
