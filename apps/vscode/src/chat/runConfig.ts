import * as vscode from "vscode";
import {
  clampMaxTokens,
  DEFAULT_RUN_TIMEOUT_MS,
  type AgentMode,
  type ApprovalMode,
} from "@ninjacode/core";
import type { SandboxMode } from "@ninjacode/tools";
import {
  getModelInfo,
  type ProviderKind,
  type ReasoningEffort,
} from "@ninjacode/providers";
import { getSecretApiKey } from "../secrets.js";
import { gatewayApiBase, resolveLocalBase } from "../providerHelper.js";
import { clampApprovalForTrust } from "../workspaceTrust.js";
import { fetchGatewayModels } from "../settingsGateway.js";
import { enrichRunConfigFromLiveModels, resolveContextWindow } from "./runConfigContext.js";

/** Everything a run needs from VS Code configuration, resolved once per message. */
interface RunConfig {
  kind: ProviderKind;
  model?: string;
  baseUrl?: string;
  mode: AgentMode;
  approvalMode: ApprovalMode;
  sandboxMode: SandboxMode;
  runTimeoutMs: number;
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
  const contextWindow = resolveContextWindow(configuredWindow, modelInfo);

  return {
    kind,
    model,
    baseUrl: resolveBaseUrl(cfg, kind),
    mode: modeOverride ?? cfg.get<AgentMode>("mode") ?? "agent",
    approvalMode: clampApprovalForTrust(cfg.get<ApprovalMode>("approvalMode") ?? "balanced"),
    sandboxMode: vscode.workspace.isTrusted
      ? (cfg.get<SandboxMode>("sandboxMode") ?? "workspace-write")
      : "read-only",
    runTimeoutMs: cfg.get<number>("runTimeoutMs") || DEFAULT_RUN_TIMEOUT_MS,
    contextWindow,
    maxTokens: clampMaxTokens(modelInfo?.maxOutput ?? 8192, contextWindow),
    ...resolveReasoning(cfg, modelInfo),
    vision: modelInfo ? Boolean(modelInfo.vision) : true,
  };
}

/** Live gateway catalogs include models the compiled package does not know. */
export async function withGatewayContextWindow(
  config: RunConfig,
  apiKey: string,
): Promise<RunConfig> {
  if (config.kind !== "gateway" || config.contextWindow) return config;
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const live = await fetchGatewayModels(gatewayApiBase(cfg), apiKey);
  if (!live.ok) return config;
  return enrichRunConfigFromLiveModels(config, live.models);
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
