import * as vscode from "vscode";
import type { ProviderKind } from "@ninjacode/providers";
import { normalizeGatewayBase } from "./providerHelper.js";
import { CHAT_LOCATION_CONTEXT } from "./chat/chatLocation.js";
import { t } from "./locale.js";
import type { SettingsMessage } from "./settingsTypes.js";
import { BILLING_HANDLERS, type BillingHandlerContext } from "./billingHandlers.js";

interface ApplySettingsHooks {
  focusChat(): Promise<void>;
  scheduleChange(): void;
}

export async function applySettings(msg: SettingsMessage, hooks: ApplySettingsHooks): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  try {
    await applyProviderFields(cfg, msg, target);
    await applyUrlField(cfg, msg, target);
    await applyChatLocation(cfg, msg, hooks);
    await applyModeFields(cfg, msg, target);
  } catch (e) {
    vscode.window.showErrorMessage(
      t("NinjaCode: failed to save settings — {0}", (e as Error).message),
    );
  }
  hooks.scheduleChange();
}

async function applyProviderFields(
  cfg: vscode.WorkspaceConfiguration,
  msg: SettingsMessage,
  target: vscode.ConfigurationTarget,
): Promise<void> {
  if (msg.provider) await cfg.update("provider", msg.provider, target);
  if (msg.model !== undefined) await cfg.update("model", msg.model, target);
  if (!msg.providers) return;
  await cfg.update("providers", msg.providers, vscode.ConfigurationTarget.Global);
  if (vscode.workspace.workspaceFolders?.length) {
    await cfg.update("providers", undefined, vscode.ConfigurationTarget.Workspace);
  }
}

async function applyUrlField(
  cfg: vscode.WorkspaceConfiguration,
  msg: SettingsMessage,
  target: vscode.ConfigurationTarget,
): Promise<void> {
  if (msg.baseUrl === undefined) return;
  const urlKind = (msg.configKind ??
    msg.provider ??
    cfg.get<ProviderKind>("provider") ??
    "anthropic") as ProviderKind;
  if (urlKind === "local") {
    await cfg.update("localBaseUrl", msg.baseUrl, vscode.ConfigurationTarget.Global);
    return;
  }
  if (urlKind === "gateway") {
    await cfg.update(
      "gatewayUrl",
      normalizeGatewayBase(msg.baseUrl),
      vscode.ConfigurationTarget.Global,
    );
    return;
  }
  await cfg.update("baseUrl", msg.baseUrl, target);
}

async function applyChatLocation(
  cfg: vscode.WorkspaceConfiguration,
  msg: SettingsMessage,
  hooks: ApplySettingsHooks,
): Promise<void> {
  if (!msg.chatLocation) return;
  await cfg.update("chatLocation", msg.chatLocation, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand("setContext", CHAT_LOCATION_CONTEXT, msg.chatLocation);
  setTimeout(() => {
    void hooks.focusChat();
  }, 150);
}

async function applyModeFields(
  cfg: vscode.WorkspaceConfiguration,
  msg: SettingsMessage,
  target: vscode.ConfigurationTarget,
): Promise<void> {
  if (msg.mode) await cfg.update("mode", msg.mode, target);
  if (msg.approvalMode) await cfg.update("approvalMode", msg.approvalMode, target);
  if (msg.reasoningEffort) await cfg.update("reasoningEffort", msg.reasoningEffort, target);
  if (msg.thinkingBudgetTokens !== undefined) {
    await cfg.update("thinkingBudgetTokens", msg.thinkingBudgetTokens, target);
  }
  if (msg.contextWindow !== undefined) {
    await cfg.update("contextWindow", msg.contextWindow, target);
  }
}

interface MessageHandlerContext extends BillingHandlerContext {
  update(key: string, value: unknown): Promise<void>;
  setApiKey(kind: ProviderKind, key: string): Promise<void>;
  clearApiKey(kind: ProviderKind): Promise<void>;
  startMagicLink(email: string): Promise<void>;
  startBrowserLogin(): Promise<void>;
  scheduleChange(): void;
  onSignedOut(): Promise<void>;
}

const ACCOUNT_HANDLERS: Record<string, (msg: SettingsMessage, ctx: MessageHandlerContext) => Promise<void>> = {
  account_browser_login: async (_msg, ctx) => {
    await ctx.startBrowserLogin();
  },
  account_login: async (msg, ctx) => {
    if (msg.email) await ctx.startMagicLink(msg.email);
  },
  account_paste_key: async (msg, ctx) => {
    if (!msg.key) return;
    await ctx.setApiKey("gateway", msg.key);
    ctx.scheduleChange();
  },
  account_logout: async (_msg, ctx) => {
    await ctx.clearApiKey("gateway");
    await ctx.onSignedOut();
    ctx.scheduleChange();
  },
  account_refresh: async (_msg, ctx) => {
    ctx.scheduleChange();
  },
};

const PREFERENCE_HANDLERS: Record<string, (msg: SettingsMessage, ctx: MessageHandlerContext) => Promise<void>> = {
  set_mode: async (msg, ctx) => {
    if (msg.mode) await ctx.update("mode", msg.mode);
  },
  set_model: async (msg, ctx) => {
    if (msg.model !== undefined) await ctx.update("model", msg.model);
  },
  set_favorite_models: async (msg, ctx) => {
    if (!msg.models) return;
    await ctx.update("favoriteModels", msg.models);
    ctx.scheduleChange();
  },
  set_model_sort: async (msg, ctx) => {
    if (!msg.sort) return;
    await ctx.update("modelSort", msg.sort);
    ctx.scheduleChange();
  },
  set_reasoning: async (msg, ctx) => {
    if (msg.reasoningEffort) await ctx.update("reasoningEffort", msg.reasoningEffort);
    if (msg.thinkingBudgetTokens !== undefined) {
      await ctx.update("thinkingBudgetTokens", msg.thinkingBudgetTokens);
    }
  },
  set_context_window: async (msg, ctx) => {
    if (msg.contextWindow !== undefined) await ctx.update("contextWindow", msg.contextWindow);
  },
  toggle_sidebar_position: async (_msg, ctx) => {
    await vscode.commands.executeCommand("workbench.action.toggleSidebarPosition");
    ctx.scheduleChange();
  },
  set_locale: async (msg, ctx) => {
    if (!msg.locale) return;
    await ctx.update("locale", msg.locale);
    ctx.scheduleChange();
  },
};

export async function handleSettingsMessage(
  msg: SettingsMessage,
  ctx: MessageHandlerContext,
): Promise<boolean> {
  if (msg.type === "set_api_key") {
    if (msg.kind && msg.key) {
      await ctx.setApiKey(msg.kind, msg.key);
      vscode.window.showInformationMessage(t("NinjaCode: API key saved for {0}.", msg.kind));
      ctx.scheduleChange();
    }
    return true;
  }
  if (msg.type === "clear_api_key") {
    if (msg.kind) {
      await ctx.clearApiKey(msg.kind);
      ctx.scheduleChange();
    }
    return true;
  }
  const accountHandler = ACCOUNT_HANDLERS[msg.type];
  if (accountHandler) {
    await accountHandler(msg, ctx);
    return true;
  }
  const billingHandler = BILLING_HANDLERS[msg.type];
  if (billingHandler) {
    await billingHandler(msg, ctx);
    return true;
  }
  const prefHandler = PREFERENCE_HANDLERS[msg.type];
  if (prefHandler) {
    await prefHandler(msg, ctx);
    return true;
  }
  return false;
}
