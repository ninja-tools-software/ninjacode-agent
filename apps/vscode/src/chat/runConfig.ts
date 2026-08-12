import * as vscode from "vscode";
import type { AgentMode, ApprovalMode } from "@ninjacode/core";
import {
  getModelInfo,
  type ProviderKind,
  type ReasoningEffort,
} from "@ninjacode/providers";
import { getSecretApiKey } from "../secrets.js";
import { gatewayApiBase, resolveLocalBase } from "../providerHelper.js";
import { clampApprovalForTrust } from "../workspaceTrust.js";

/** Everything a run needs from VS Code configuration, resolved once per message. */
interface RunConfig {
  kind: ProviderKind;
  model?: string;
  baseUrl?: string;
  mode: AgentMode;
  approvalMode: ApprovalMode;
  contextWindow?: number;
  maxTokens: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  vision: boolean;
}

function resolveBaseUrl(cfg: vscode.WorkspaceConfiguration, kind: ProviderKind): string | undefined {
  if (kind === "gateway") return gatewayApiBase(cfg);
  if (kind === "local") return resolveLocalBase(cfg);
  return cfg.get<string>("baseUrl") || undefined;
}

function resolveContextWindow(
  configuredWindow: number,
  modelInfo: ReturnType<typeof getModelInfo>,
): number | undefined {
  if (configuredWindow > 0) {
    return Math.min(configuredWindow, modelInfo?.contextWindow ?? configuredWindow);
  }
  return modelInfo?.defaultContextWindow ?? modelInfo?.contextWindow;
}

function resolveReasoning(
  cfg: vscode.WorkspaceConfiguration,
  modelInfo: ReturnType<typeof getModelInfo>,
): Pick<RunConfig, "reasoningEffort" | "thinkingBudgetTokens"> {
  const reasoning = modelInfo?.reasoning;
  if (reasoning?.kind === "levels") {
    const fallback = reasoning.default ?? "medium";
    return { reasoningEffort: cfg.get<ReasoningEffort>("reasoningEffort") ?? fallback };
  }
  if (reasoning?.kind === "budget") {
    return {
      thinkingBudgetTokens: cfg.get<number>("thinkingBudgetTokens") ?? reasoning.default,
    };
  }
  return {};
}

export function readRunConfig(modeOverride?: AgentMode): RunConfig {
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const kind = cfg.get<ProviderKind>("provider") ?? "gateway";
  const model = cfg.get<string>("model") || undefined;
  const configuredWindow = cfg.get<number>("contextWindow") ?? 0;
  const modelInfo = getModelInfo(kind, model ?? "");

  return {
    kind,
    model,
    baseUrl: resolveBaseUrl(cfg, kind),
    mode: modeOverride ?? cfg.get<AgentMode>("mode") ?? "agent",
    approvalMode: clampApprovalForTrust(cfg.get<ApprovalMode>("approvalMode") ?? "balanced"),
    contextWindow: resolveContextWindow(configuredWindow, modelInfo),
    maxTokens: modelInfo?.maxOutput ?? 8192,
    ...resolveReasoning(cfg, modelInfo),
    vision: modelInfo ? Boolean(modelInfo.vision) : true,
  };
}

export async function ensureApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
): Promise<string | undefined> {
  let apiKey = (await getSecretApiKey(context, kind)) ?? "";
  if (kind === "mock" || kind === "local" || apiKey) return apiKey;
  if (kind === "gateway") return promptGatewaySignIn();

  const choice = await vscode.window.showWarningMessage(
    `NinjaCode: no API key set for ${kind}.`,
    "Set API Key",
    "Open Settings",
  );
  if (choice === "Set API Key") await vscode.commands.executeCommand("ninjacode.setApiKey");
  if (choice === "Open Settings") await vscode.commands.executeCommand("ninjacode.openSettings");

  apiKey = (await getSecretApiKey(context, kind)) ?? "";
  return apiKey || undefined;
}

async function promptGatewaySignIn(): Promise<undefined> {
  const { t } = await import("../locale.js");
  const signIn = t("Sign in");
  const openSettings = t("Open Settings");
  const choice = await vscode.window.showWarningMessage(
    t("NinjaCode: sign in to NinjaCode Pass to continue."),
    signIn,
    openSettings,
  );
  if (choice === signIn) {
    const { startBrowserLogin, webUrlFromConfig } = await import("../settingsGateway.js");
    await startBrowserLogin(webUrlFromConfig());
  }
  if (choice === openSettings) await vscode.commands.executeCommand("ninjacode.openSettings");
  return undefined;
}

export function grantsFrom(saved: readonly string[]): Array<{ tool: string; target: string }> {
  const out: Array<{ tool: string; target: string }> = [];
  for (const g of saved) {
    const idx = g.indexOf(":");
    if (idx === -1) continue;
    const tool = g.slice(0, idx);
    const target = g.slice(idx + 1);
    if (tool && target) out.push({ tool, target });
  }
  return out;
}
