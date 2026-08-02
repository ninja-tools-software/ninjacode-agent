import * as vscode from "vscode";
import type { AgentMode } from "@ninjacode/core";
import type { HostToWebview } from "../protocol.js";
import { t } from "../locale.js";
import { gatewayApiBase } from "../providerHelper.js";
import { getSecretApiKey } from "../secrets.js";
import { readRunConfig } from "./runConfig.js";

type Post = (payload: HostToWebview) => void;

/** Prefer gateway `text`; fall back to the original prompt when empty/missing. */
export function resolveEnrichResultText(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback.trim();
  const text = (data as { text?: unknown }).text;
  if (typeof text !== "string") return fallback.trim();
  return text.trim() || fallback.trim();
}

function postError(post: Post, requestId: string, text: string): void {
  post({ type: "enhance_prompt_error", requestId, text });
}

async function callEnrichEndpoint(opts: {
  apiBase: string;
  apiKey: string;
  text: string;
  mode?: AgentMode;
}): Promise<{ ok: true; text: string } | { ok: false; status: number; body: { error?: string; message?: string } }> {
  const res = await fetch(`${opts.apiBase}/prompt/enrich`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ text: opts.text, mode: opts.mode }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok) return { ok: false, status: res.status, body };
  return { ok: true, text: resolveEnrichResultText(body, opts.text) };
}

function httpFailureMessage(status: number, body: { error?: string; message?: string }): string {
  if (status === 401) {
    return t("Prompt enhancement failed — sign in to the gateway first.");
  }
  if (status === 402) {
    return t(
      "Prompt enhancement failed: {0}",
      body.message ?? "insufficient credits",
    );
  }
  return t(
    "Prompt enhancement failed: {0}",
    body.message ?? body.error ?? `HTTP ${status}`,
  );
}

/** Run a one-shot rewrite of the composer prompt via the gateway enrich route. */
export async function handleEnhancePrompt(
  context: vscode.ExtensionContext,
  msg: { requestId: string; text: string; mode?: AgentMode },
  post: Post,
): Promise<void> {
  const { requestId, text, mode } = msg;
  const trimmed = text.trim();
  if (!trimmed) {
    postError(post, requestId, t("Nothing to enhance — type a prompt first."));
    return;
  }

  const config = readRunConfig();
  if (config.kind !== "gateway") {
    postError(post, requestId, t("Prompt enhancement requires the NinjaCode gateway."));
    return;
  }

  const apiKey = await getSecretApiKey(context, "gateway");
  if (!apiKey) {
    postError(post, requestId, t("Prompt enhancement failed — sign in to the gateway first."));
    return;
  }

  const cfg = vscode.workspace.getConfiguration("ninjacode");
  try {
    const result = await callEnrichEndpoint({
      apiBase: gatewayApiBase(cfg),
      apiKey,
      text: trimmed,
      mode,
    });
    if (!result.ok) {
      postError(post, requestId, httpFailureMessage(result.status, result.body));
      return;
    }
    post({ type: "enhance_prompt_result", requestId, text: result.text });
  } catch (e) {
    postError(post, requestId, t("Prompt enhancement failed: {0}", (e as Error).message));
  }
}
