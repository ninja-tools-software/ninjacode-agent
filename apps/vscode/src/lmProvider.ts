import * as vscode from "vscode";
import { createProvider, getProviderCatalog, type ModelInfo, type ProviderKind } from "@ninjacode/providers";
import { gatewayApiBase } from "./providerHelper.js";
import type { Message, Role } from "@ninjacode/providers";
import { getSecretApiKey, hasSecretApiKey } from "./secrets.js";

/**
 * Native VS Code Language Model (BYOK) integration: exposes NinjaCode's configured
 * providers/models to the built-in model picker via `vscode.lm.registerLanguageModelChatProvider`.
 *
 * This API — and the `languageModelChatProviders` contribution point it depends on — is a
 * recent addition, so it's entirely feature-detected. If it isn't present (older VS Code,
 * or a fork that hasn't implemented it), registration is skipped silently.
 */

const LM_VENDOR = "ninjacode";

/** The provider kinds we're willing to surface as native language models. Excludes
 * `openai-compatible` and `local` (need a `baseUrl` we can't infer) and `echo` (test-only). */
const EXPOSABLE_KINDS: ProviderKind[] = [
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "moonshot",
  "glm",
  "mistral",
  "xai",
  "mock",
];

// Minimal local mirrors of the (partly proposed / recently-stabilized) `vscode.lm` types,
// used so this file compiles even if the installed `@types/vscode` hasn't caught up yet.
interface LmChatInformation {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly version: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly tooltip?: string;
  readonly detail?: string;
  readonly capabilities: { readonly imageInput?: boolean; readonly toolCalling?: boolean | number };
}

interface LmChatRequestMessage {
  readonly role: unknown;
  readonly content: ReadonlyArray<unknown>;
  readonly name?: string;
}

/** `${ProviderKind}::${modelId}`, kept opaque to callers outside this module. */
function toNativeId(kind: ProviderKind, modelId: string): string {
  return `${kind}::${modelId}`;
}

function fromNativeId(id: string): { kind: ProviderKind; modelId: string } | undefined {
  const idx = id.indexOf("::");
  if (idx === -1) return undefined;
  return { kind: id.slice(0, idx) as ProviderKind, modelId: id.slice(idx + 2) };
}

function toChatInformation(kind: ProviderKind, label: string, model: ModelInfo): LmChatInformation {
  return {
    id: toNativeId(kind, model.id),
    name: `${label}: ${model.label}`,
    family: kind,
    version: "1.0.0",
    maxInputTokens: Math.max(1, model.contextWindow - model.maxOutput),
    maxOutputTokens: model.maxOutput,
    tooltip: `NinjaCode (BYOK) — ${label} ${model.label}`,
    detail: "via NinjaCode",
    capabilities: {
      imageInput: model.vision ?? false,
      toolCalling: false,
    },
  };
}

function roleToOurs(role: unknown): Role {
  const Enum = (vscode as unknown as { LanguageModelChatMessageRole?: Record<string, unknown> })
    .LanguageModelChatMessageRole;
  if (Enum && role === Enum.Assistant) return "assistant";
  return "user";
}

function extractText(content: ReadonlyArray<unknown>): string {
  const TextPart = (vscode as unknown as { LanguageModelTextPart?: new (value: string) => unknown })
    .LanguageModelTextPart;
  let out = "";
  for (const part of content) {
    if (TextPart && part instanceof TextPart) {
      out += (part as unknown as { value: string }).value;
    } else if (part && typeof part === "object" && "value" in (part as Record<string, unknown>)) {
      const v = (part as Record<string, unknown>).value;
      if (typeof v === "string") out += v;
    }
  }
  return out;
}

function messagesToOurs(messages: readonly LmChatRequestMessage[]): Message[] {
  return messages.map((m) => ({
    role: roleToOurs(m.role),
    content: extractText(m.content),
  }));
}

async function streamLanguageModelResponse(opts: {
  context: vscode.ExtensionContext;
  model: LmChatInformation;
  messages: readonly LmChatRequestMessage[];
  progress: vscode.Progress<unknown>;
  token: vscode.CancellationToken;
}): Promise<void> {
  const parsed = fromNativeId(opts.model.id);
  if (!parsed) throw new Error(`NinjaCode: unrecognized model id "${opts.model.id}"`);
  const { kind, modelId } = parsed;

  const apiKey = (await getSecretApiKey(opts.context, kind)) ?? "";
  if (kind !== "mock" && kind !== "echo" && !apiKey) {
    throw new Error(`NinjaCode: no API key configured for ${kind}. Run "NinjaCode: Set API Key".`);
  }

  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const baseUrl =
    kind === "gateway" ? gatewayApiBase(cfg) : cfg.get<string>("baseUrl") || undefined;

  const llm = createProvider({ kind, apiKey, model: modelId, baseUrl });
  const controller = new AbortController();
  opts.token.onCancellationRequested(() => controller.abort());

  const TextPart = (vscode as unknown as { LanguageModelTextPart: new (value: string) => unknown })
    .LanguageModelTextPart;

  await llm.completeStreaming(
    {
      messages: messagesToOurs(opts.messages),
      model: modelId,
      maxTokens: opts.model.maxOutputTokens,
      signal: controller.signal,
    },
    (event) => {
      if (event.type === "text_delta" && event.text) {
        opts.progress.report(new TextPart(event.text));
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    },
  );
}

class NinjaCodeLanguageModelChatProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async provideLanguageModelChatInformation(
    options: { silent?: boolean },
    _token: vscode.CancellationToken,
  ): Promise<LmChatInformation[]> {
    const cfg = vscode.workspace.getConfiguration("ninjacode");
    const configuredKinds =
      cfg.get<ProviderKind[]>("providers")?.filter((k) => EXPOSABLE_KINDS.includes(k)) ??
      EXPOSABLE_KINDS;

    const infos: LmChatInformation[] = [];
    for (const kind of configuredKinds) {
      const needsKey = kind !== "mock" && kind !== "echo";
      if (needsKey) {
        // In silent mode we must not prompt — only list what's already configured.
        const has = await hasSecretApiKey(this.context, kind);
        if (!has) continue;
      }
      const catalog = getProviderCatalog(kind);
      if (!catalog) continue;
      for (const model of catalog.models) {
        infos.push(toChatInformation(kind, catalog.label, model));
      }
    }
    void options.silent;
    return infos;
  }

  async provideLanguageModelChatResponse(
    ...args: [
      LmChatInformation,
      readonly LmChatRequestMessage[],
      unknown,
      vscode.Progress<unknown>,
      vscode.CancellationToken,
    ]
  ): Promise<void> {
    const [model, messages, _options, progress, token] = args;
    await streamLanguageModelResponse({ context: this.context, model, messages, progress, token });
  }

  async provideTokenCount(
    _model: LmChatInformation,
    text: string | LmChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const str = typeof text === "string" ? text : extractText(text.content);
    // Rough heuristic (~4 chars/token); NinjaCode's providers don't expose exact
    // tokenizers for every backend, so this mirrors the estimate used elsewhere.
    return Math.ceil(str.length / 4);
  }
}

/**
 * Registers NinjaCode as a native `languageModelChatProviders` vendor if
 * `vscode.lm.registerLanguageModelChatProvider` exists at runtime. Returns `undefined`
 * (and registers nothing) otherwise.
 */
export function registerLmProvider(context: vscode.ExtensionContext): vscode.Disposable | undefined {
  const lmApi = (vscode as unknown as { lm?: Record<string, unknown> }).lm;
  const registerLanguageModelChatProvider = lmApi?.registerLanguageModelChatProvider as
    | ((vendor: string, provider: NinjaCodeLanguageModelChatProvider) => vscode.Disposable)
    | undefined;

  if (typeof registerLanguageModelChatProvider !== "function") {
    // `vscode.lm.registerLanguageModelChatProvider` isn't available on this build — skip silently.
    return undefined;
  }

  return registerLanguageModelChatProvider(LM_VENDOR, new NinjaCodeLanguageModelChatProvider(context));
}
