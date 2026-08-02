import type { ProviderKind } from "@ninjacode/providers";
import type { ChatLocation } from "./chat/chatLocation.js";

/** Settings-related subset of the messages a webview can send. */
export interface SettingsMessage {
  type: string;
  kind?: ProviderKind;
  key?: string;
  email?: string;
  provider?: ProviderKind;
  providers?: ProviderKind[];
  /** When set on update_settings, the baseUrl update targets this provider's URL config
   * (baseUrl / gatewayUrl / localBaseUrl) without changing the active provider. */
  configKind?: ProviderKind;
  model?: string;
  /** `set_favorite_models`: the full starred list, replacing whatever was stored. */
  models?: string[];
  reasoningEffort?: import("@ninjacode/providers").ReasoningEffort;
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  chatLocation?: ChatLocation;
  baseUrl?: string;
  tier?: string;
  mode?: string;
  approvalMode?: string;
  locale?: "auto" | "en" | "fr";
}
