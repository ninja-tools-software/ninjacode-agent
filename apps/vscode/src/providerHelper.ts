import * as vscode from "vscode";
import path from "node:path";
import {
  createProvider,
  getModelInfo,
  type LlmProvider,
  type Message,
  type ProviderKind,
} from "@ninjacode/providers";
import { getSecretApiKey } from "./secrets.js";

interface QuickProvider {
  llm: LlmProvider;
  model?: string;
  maxTokens: number;
}

/** Normalize gateway host URL (no trailing slash, no /v1 suffix). */
export function normalizeGatewayBase(url: string): string {
  return url.trim().replace(/\/$/, "").replace(/\/v1$/i, "");
}

/** Resolve Pass/gateway base URL from VS Code settings. */
export function resolveGatewayBase(cfg: vscode.WorkspaceConfiguration): string {
  const gatewayUrl = cfg.get<string>("gatewayUrl");
  const baseUrl = cfg.get<string>("baseUrl");
  return (
    normalizeGatewayBase(gatewayUrl ?? "") ||
    normalizeGatewayBase(baseUrl ?? "") ||
    "http://127.0.0.1:8788"
  );
}

/**
 * Public web app origin used for browser sign-in (`/connect-ide`).
 * Prefer `ninjacode.webUrl`; otherwise derive from the gateway host.
 */
export function resolveWebUrl(cfg: vscode.WorkspaceConfiguration): string {
  const explicit = (cfg.get<string>("webUrl") ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  return deriveWebUrlFromGateway(resolveGatewayBase(cfg));
}

/** Pure helper — gateway `api.*` → apex; localhost → :4200. */
export function deriveWebUrlFromGateway(gatewayBase: string): string {
  try {
    const u = new URL(gatewayBase);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      u.port = "4200";
      return u.origin;
    }
    if (u.hostname.startsWith("api.")) {
      u.hostname = u.hostname.slice(4);
      return u.origin;
    }
    return u.origin;
  } catch {
    return "https://ninjacode.dev";
  }
}

export function gatewayApiBase(cfg: vscode.WorkspaceConfiguration): string {
  return `${resolveGatewayBase(cfg)}/v1`;
}

/** Resolve the local LLM server base URL from VS Code settings. */
export function resolveLocalBase(cfg: vscode.WorkspaceConfiguration): string {
  return (cfg.get<string>("localBaseUrl") || "").trim().replace(/\/$/, "") || "http://localhost:11434/v1";
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /credentials\.json$/i,
  /^secrets?\.(ya?ml|json|toml)$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pgpass$/i,
  /\.keystore$/i,
];

/** True when `fsPath` looks like a secrets/credentials file that should be skipped by AI features. */
export function isSensitivePath(fsPath: string): boolean {
  const base = path.basename(fsPath);
  return SENSITIVE_PATTERNS.some((re) => re.test(base));
}

async function ensureQuickApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
  silent: boolean,
): Promise<string | undefined> {
  const apiKey = (await getSecretApiKey(context, kind)) ?? "";
  if (kind === "mock" || kind === "echo" || kind === "local" || apiKey) return apiKey;
  if (silent) return undefined;
  const pick = await vscode.window.showWarningMessage(
    `NinjaCode: no API key set for ${kind}.`,
    "Set API Key",
  );
  if (pick === "Set API Key") await vscode.commands.executeCommand("ninjacode.setApiKey");
  return (await getSecretApiKey(context, kind)) ?? undefined;
}

function quickProviderBaseUrl(cfg: vscode.WorkspaceConfiguration, kind: ProviderKind): string | undefined {
  if (kind === "gateway") return gatewayApiBase(cfg);
  if (kind === "local") return resolveLocalBase(cfg);
  return cfg.get<string>("baseUrl") || undefined;
}

/**
 * Resolve the currently configured LLM provider using the same secrets/settings
 * as the chat view, for use by lightweight editor surfaces (inline edit, quick
 * chat, completions, next-edit, code actions).
 */
export async function getQuickProvider(
  context: vscode.ExtensionContext,
  opts: { modelOverride?: string; maxTokens?: number; silent?: boolean } = {},
): Promise<QuickProvider | undefined> {
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const kind = (cfg.get<ProviderKind>("provider") ?? "anthropic") as ProviderKind;
  const model = opts.modelOverride || cfg.get<string>("model") || undefined;
  const apiKey = await ensureQuickApiKey(context, kind, Boolean(opts.silent));
  const keylessOk = kind === "mock" || kind === "echo" || kind === "local";
  if (!apiKey && !keylessOk) return undefined;

  return buildQuickProvider({ cfg, kind, model, apiKey: apiKey ?? "", maxTokens: opts.maxTokens });
}

function buildQuickProvider(opts: {
  cfg: vscode.WorkspaceConfiguration;
  kind: ProviderKind;
  model: string | undefined;
  apiKey: string;
  maxTokens?: number;
}): QuickProvider {
  const llm = createProvider({
    kind: opts.kind,
    apiKey: opts.apiKey,
    model: opts.model,
    baseUrl: quickProviderBaseUrl(opts.cfg, opts.kind),
  });
  const modelInfo = getModelInfo(opts.kind, opts.model ?? "");
  return {
    llm,
    model: opts.model || modelInfo?.id,
    maxTokens: Math.min(opts.maxTokens ?? 4096, modelInfo?.maxOutput ?? 4096),
  };
}

export function buildMessages(system: string, user: string): Message[] {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Strip a single leading/trailing fenced code block (```lang\n...\n```), if present. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1]! : trimmed;
}

/** Relative workspace path for a document, or its fsPath if outside any workspace folder. */
export function relativePath(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false);
  return rel || uri.fsPath;
}
