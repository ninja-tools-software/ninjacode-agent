import * as vscode from "vscode";
import { getProviderCatalog, type ModelInfo } from "@ninjacode/providers";
import { t } from "./locale.js";
import { mapGatewayModel, type GatewayModelWire } from "./gatewayModelMap.js";
import { parseOverage } from "./billingGateway.js";
import { resolveGatewayBase, resolveWebUrl } from "./providerHelper.js";
import type { AccountOveragePayload } from "./protocol.js";

type GatewayModelsResult =
  | {
      ok: true;
      models: ModelInfo[];
      catalog?: string;
      /** Contractual attribution string from Artificial Analysis / Design Arena. */
      benchmarkAttribution?: string | null;
    }
  | { ok: false; models: [] };

export interface AccountInfo {
  email: string;
  credits: number;
  creditsIncluded: number;
  renewsAt: string | null;
  passTier: string | null;
  passStreakMonths: number;
  catalogSlug?: string | null;
  planKind: "monthly" | "commitment" | null;
  commitmentEndsAt: string | null;
  cancelAt: string | null;
  overage: AccountOveragePayload | null;
}

export interface UsageRow {
  model?: string;
  createdAt?: string;
  credits?: number;
  inputTokens?: number;
  outputTokens?: number;
}

const MODELS_CACHE_TTL_MS = 60_000;

let modelsCache:
  | { key: string; at: number; result: Extract<GatewayModelsResult, { ok: true }> }
  | undefined;

/** Last successful gateway catalog without network I/O (TTL-aware). */
export function peekCachedGatewayModels(): ModelInfo[] | undefined {
  if (!modelsCache) return undefined;
  if (Date.now() - modelsCache.at >= MODELS_CACHE_TTL_MS) return undefined;
  return modelsCache.result.models;
}

export async function fetchGatewayModels(
  gatewayBase: string,
  apiKey?: string,
): Promise<GatewayModelsResult> {
  if (!apiKey) return { ok: false, models: [] };
  const key = `${gatewayBase}::${apiKey}`;
  if (modelsCache && modelsCache.key === key && Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS) {
    return modelsCache.result;
  }
  const result = await requestGatewayModels(gatewayBase, apiKey);
  if (result.ok) modelsCache = { key, at: Date.now(), result };
  return result;
}

async function requestGatewayModels(
  gatewayBase: string,
  apiKey: string,
): Promise<GatewayModelsResult> {
  try {
    const res = await fetch(`${gatewayBase}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { ok: false, models: [] };
    const data = (await res.json()) as {
      catalog?: string;
      models?: GatewayModelWire[];
      benchmarkAttribution?: string | null;
    };
    const catalog = getProviderCatalog("gateway");
    const models = (data.models ?? []).map((m) =>
      mapGatewayModel(
        m,
        catalog?.models.find((x) => x.id === m.id),
        data.catalog,
      ),
    );
    return {
      ok: true,
      models,
      catalog: data.catalog,
      benchmarkAttribution:
        typeof data.benchmarkAttribution === "string" ? data.benchmarkAttribution : null,
    };
  } catch {
    return { ok: false, models: [] };
  }
}

/** Fetch available models from a local OpenAI-compatible server (Ollama, LM Studio, ...). */
export async function fetchLocalModels(baseUrl: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{ id: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const list = data.data ?? data.models ?? [];
    return list
      .map((m) => ("id" in m ? m.id : m.name) ?? "")
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        id,
        label: id,
        contextWindow: 32_000,
        maxOutput: 8_192,
      }));
  } catch {
    return [];
  }
}

export async function fetchAccount(gatewayBase: string, apiKey: string): Promise<AccountInfo | null> {
  try {
    const res = await fetch(`${gatewayBase}/v1/account`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Partial<AccountInfo> & {
      email: string;
      passTier: string | null;
      passStreakMonths: number;
      planKind?: string | null;
      commitmentEndsAt?: string | null;
      cancelAt?: string | null;
      overage?: unknown;
    };
    const planKind = raw.planKind === "monthly" || raw.planKind === "commitment" ? raw.planKind : null;
    return {
      email: raw.email,
      credits: raw.credits ?? 0,
      creditsIncluded: raw.creditsIncluded ?? 0,
      renewsAt: raw.renewsAt ?? null,
      passTier: raw.passTier,
      passStreakMonths: raw.passStreakMonths,
      catalogSlug: raw.catalogSlug ?? null,
      planKind,
      commitmentEndsAt: raw.commitmentEndsAt ?? null,
      cancelAt: raw.cancelAt ?? null,
      overage: parseOverage(raw.overage),
    };
  } catch {
    return null;
  }
}

export async function fetchUsage(gatewayBase: string, apiKey: string): Promise<UsageRow[]> {
  try {
    const res = await fetch(`${gatewayBase}/v1/usage/records?limit=50&offset=0`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<UsageRow & { creditsCharged?: number }>;
    };
    return (data.items ?? []).map((u) => ({
      model: u.model,
      createdAt: u.createdAt,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      credits: typeof u.creditsCharged === "number" ? u.creditsCharged / 1_000 : u.credits,
    }));
  } catch {
    return [];
  }
}

export async function startMagicLink(gatewayBase: string, email: string): Promise<void> {
  try {
    const res = await fetch(`${gatewayBase}/v1/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirect: "vscode" }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      link?: string;
      error?: string;
    };
    if (!res.ok) {
      vscode.window.showErrorMessage(data.error ?? t("Failed to send magic link"));
      return;
    }
    if (data.link) {
      await vscode.env.openExternal(vscode.Uri.parse(data.link));
      vscode.window.showInformationMessage(t("NinjaCode: opening magic link…"));
    } else {
      vscode.window.showInformationMessage(
        data.message ?? t("Check your email for the magic link."),
      );
    }
  } catch (e) {
    vscode.window.showErrorMessage(t("Magic link failed: {0}", (e as Error).message));
  }
}

export function gatewayBaseFromConfig(): string {
  return resolveGatewayBase(vscode.workspace.getConfiguration("ninjacode"));
}

export function webUrlFromConfig(): string {
  return resolveWebUrl(vscode.workspace.getConfiguration("ninjacode"));
}

/** Open the web connect-ide page so a browser session can mint a VS Code auth code. */
export async function startBrowserLogin(webBase: string): Promise<void> {
  const url = `${webBase.replace(/\/$/, "")}/connect-ide`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

/** Signup lands on connect-ide so a fresh account hands its key back to the IDE. */
export async function openWebPage(webBase: string, page: "signup" | "pricing"): Promise<void> {
  const path = page === "signup" ? "/signup?next=/connect-ide" : "/pricing";
  await vscode.env.openExternal(vscode.Uri.parse(`${webBase.replace(/\/$/, "")}${path}`));
}
