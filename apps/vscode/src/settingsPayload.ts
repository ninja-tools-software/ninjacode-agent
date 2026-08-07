import * as vscode from "vscode";
import type { AgentMode, ApprovalMode } from "@ninjacode/core";
import type { SettingsPayload, WireModelInfo } from "./protocol.js";
import {
  contextPresetsFor,
  fetchMammouthModels,
  getModelInfo,
  getProviderCatalog,
  listProviderCatalogs,
  type ModelInfo,
  type ProviderKind,
  type ReasoningEffort,
} from "@ninjacode/providers";
import { resolveGatewayBase, resolveLocalBase } from "./providerHelper.js";
import {
  getChatLocation,
  getPrimarySidebarSide,
  resolveChatSide,
} from "./chat/chatLocation.js";
import { resolveEffectiveLocale, resolveLocaleSetting } from "./locale.js";
import {
  normalizeFavoriteModels,
  normalizeModelSort,
  resolveSelectedModel,
} from "./gatewayModelMap.js";
import {
  fetchAccount,
  fetchGatewayModels,
  fetchLocalModels,
  fetchUsage,
  type AccountInfo,
  type UsageRow,
} from "./settingsGateway.js";

const ALL_PROVIDER_KINDS: ProviderKind[] = [
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "moonshot",
  "glm",
  "mistral",
  "mammouth",
  "openai-compatible",
  "local",
  "gateway",
  "mock",
];

interface BuildPayloadInput {
  listConfiguredKeys: (kinds: ProviderKind[]) => Promise<Record<ProviderKind, boolean>>;
  getGatewayKey: () => Promise<string | undefined>;
  /** Persist a corrected model id (retired Auto aliases, model gone from catalog). */
  correctModel?: (model: string) => Promise<void>;
}

function readProviderConfig(cfg: vscode.WorkspaceConfiguration): {
  provider: ProviderKind;
  providers: ProviderKind[];
  model: string;
} {
  const provider = (cfg.get<ProviderKind>("provider") ?? "anthropic") as ProviderKind;
  const inspected = cfg.inspect<ProviderKind[]>("providers");
  const providers = (inspected?.globalValue ??
    inspected?.workspaceValue ??
    inspected?.defaultValue ?? ["anthropic", "gateway"]) as ProviderKind[];
  const model = cfg.get<string>("model") ?? "";
  return { provider, providers, model };
}

async function resolveModels(
  provider: ProviderKind,
  cfg: vscode.WorkspaceConfiguration,
  gatewayKey?: string,
): Promise<{ models: ModelInfo[]; benchmarkAttribution?: string | null }> {
  const fallback = getProviderCatalog(provider)?.models ?? [];
  if (provider === "gateway") {
    // Successful fetch wins even when empty — the account catalog is the truth.
    // Static catalog is only a fallback when the key is missing or the request fails.
    const remote = await fetchGatewayModels(resolveGatewayBase(cfg), gatewayKey);
    if (remote.ok) {
      return {
        models: remote.models,
        benchmarkAttribution: remote.benchmarkAttribution ?? null,
      };
    }
    return { models: fallback };
  }
  if (provider === "local") {
    const remote = await fetchLocalModels(resolveLocalBase(cfg));
    return { models: remote.length ? remote : fallback };
  }
  if (provider === "mammouth") {
    const remote = await fetchMammouthModels();
    return { models: remote.length ? remote : fallback };
  }
  return { models: fallback };
}

async function loadAccountBlock(
  gatewayKey: string | undefined,
  gatewayBase: string,
): Promise<{ account: AccountInfo | null; usage: UsageRow[] }> {
  if (!gatewayKey) return { account: null, usage: [] };
  const [account, usage] = await Promise.all([
    fetchAccount(gatewayBase, gatewayKey),
    fetchUsage(gatewayBase, gatewayKey),
  ]);
  return { account, usage };
}

function baseUrlForProvider(provider: ProviderKind, cfg: vscode.WorkspaceConfiguration): string {
  if (provider === "gateway") return resolveGatewayBase(cfg);
  if (provider === "local") return resolveLocalBase(cfg);
  return cfg.get<string>("baseUrl") ?? "";
}

/** Agent wire models carry costIndex only — full rate tables stay off the UI. */
function toWireModel(m: ModelInfo): WireModelInfo {
  return {
    id: m.id,
    label: m.label,
    contextWindow: m.contextWindow,
    maxOutput: m.maxOutput,
    vision: m.vision,
    reasoning: m.reasoning,
    defaultContextWindow: m.defaultContextWindow,
    hostingRegion: m.hostingRegion,
    catalog: m.catalog,
    tags: m.tags,
    costIndex: m.costIndex,
    benchmark: m.benchmark,
    llmStats: m.llmStats,
    arenaScores: m.arenaScores,
  };
}

/** Build the full `settings` payload both surfaces render. */
export async function buildSettingsPayload(input: BuildPayloadInput): Promise<SettingsPayload> {
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const { provider, providers, model } = readProviderConfig(cfg);
  const gatewayKey = await input.getGatewayKey();
  const { models, benchmarkAttribution } = await resolveModels(provider, cfg, gatewayKey);
  // Prefer the live provider list over the static catalog — gateway catalogs
  // vary by Pass tier and can include ids unknown to the compiled package.
  const selected = resolveSelectedModel(model, models);
  const modelInfo =
    selected.modelInfo ?? getModelInfo(provider, selected.model || "") ?? models[0];
  if (selected.corrected && input.correctModel) {
    await input.correctModel(selected.model);
  }
  return assembleSettingsPayload({
    cfg,
    provider,
    providers,
    model: selected.model,
    models,
    modelInfo,
    hasApiKey: await input.listConfiguredKeys(ALL_PROVIDER_KINDS),
    gatewayKey,
    accountUsage: await loadAccountBlock(gatewayKey, resolveGatewayBase(cfg)),
    chatLocation: getChatLocation(),
    primarySidebarSide: getPrimarySidebarSide(),
    benchmarkAttribution,
  });
}

function assembleSettingsPayload(parts: {
  cfg: vscode.WorkspaceConfiguration;
  provider: ProviderKind;
  providers: ProviderKind[];
  model: string;
  models: ModelInfo[];
  modelInfo: ModelInfo | undefined;
  hasApiKey: Record<ProviderKind, boolean>;
  gatewayKey: string | undefined;
  accountUsage: Awaited<ReturnType<typeof loadAccountBlock>>;
  chatLocation: ReturnType<typeof getChatLocation>;
  primarySidebarSide: ReturnType<typeof getPrimarySidebarSide>;
  benchmarkAttribution?: string | null;
}): SettingsPayload {
  const catalogs = listProviderCatalogs()
    .filter((c) => parts.providers.includes(c.kind) || c.kind === parts.provider)
    .map((c) => ({ kind: c.kind, label: c.label, models: c.models.map(toWireModel) }));
  const providerLabels = Object.fromEntries(listProviderCatalogs().map((c) => [c.kind, c.label]));
  const { account, usage } = parts.accountUsage;
  const modelInfo = parts.modelInfo ? toWireModel(parts.modelInfo) : undefined;
  return {
    provider: parts.provider,
    providers: parts.providers,
    model: parts.model || modelInfo?.id || "",
    baseUrl: baseUrlForProvider(parts.provider, parts.cfg),
    baseUrls: {
      "openai-compatible": parts.cfg.get<string>("baseUrl") ?? "",
      gateway: resolveGatewayBase(parts.cfg),
      local: resolveLocalBase(parts.cfg),
    },
    chatLocation: parts.chatLocation,
    chatSide: resolveChatSide(parts.chatLocation, parts.primarySidebarSide),
    primarySidebarSide: parts.primarySidebarSide,
    mode: parts.cfg.get<AgentMode>("mode") ?? "agent",
    approvalMode: parts.cfg.get<ApprovalMode>("approvalMode") ?? "balanced",
    reasoningEffort: parts.cfg.get<ReasoningEffort>("reasoningEffort") ?? "medium",
    thinkingBudgetTokens: parts.cfg.get<number>("thinkingBudgetTokens") ?? 10_000,
    contextWindow: parts.cfg.get<number>("contextWindow") ?? 0,
    catalogs,
    providerLabels,
    models: parts.models.map(toWireModel),
    modelInfo,
    favoriteModels: normalizeFavoriteModels(
      parts.cfg.get<string[]>("favoriteModels") ?? [],
      parts.models,
    ),
    modelSort: normalizeModelSort(parts.cfg.get<string>("modelSort")),
    contextPresets: parts.modelInfo ? contextPresetsFor(parts.modelInfo) : [],
    hasApiKey: parts.hasApiKey,
    account,
    usage,
    gatewayConfigured: Boolean(parts.gatewayKey),
    benchmarkAttribution: parts.benchmarkAttribution ?? null,
    locale: resolveEffectiveLocale(),
    localeSetting: resolveLocaleSetting(),
  };
}
