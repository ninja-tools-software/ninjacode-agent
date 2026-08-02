import * as vscode from "vscode";
import {
  Agent,
  PermissionEngine,
  defaultPermissionPolicy,
  type AgentMode,
  type ApprovalMode,
} from "@ninjacode/core";
import { createProvider, getModelInfo, type ProviderKind } from "@ninjacode/providers";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import { getSecretApiKey } from "./secrets.js";
import { buildMessages, gatewayApiBase, getQuickProvider } from "./providerHelper.js";

/**
 * Native VS Code Chat integration (`@ninjacode` in the built-in Chat view).
 *
 * This is purely additive: the NinjaCode webview/sidebar remains the primary UI.
 * The `vscode.chat` namespace is a fairly recent addition, and some VS Code forks
 * either omit it or ship a partial implementation, so every access is feature-
 * detected and wrapped so a missing/broken API can never break `activate()`.
 */

const CHAT_PARTICIPANT_ID = "ninjacode.chat";

const ASK_SYSTEM_PROMPT = `You are NinjaCode, answering a question inside the VS Code Chat view. Be helpful,
direct, and concise. Use markdown (including fenced code blocks) for any code you include. You do not have
tool access in this mode — for multi-file edits or running commands, tell the user to try \`/agent\` or open
the NinjaCode sidebar.`;

interface MinimalChatRequest {
  prompt: string;
  command?: string;
}

type ChatEventPayload = Record<string, unknown>;

/**
 * Registers the `@ninjacode` chat participant if `vscode.chat.createChatParticipant`
 * exists at runtime. Returns `undefined` (and registers nothing) otherwise.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
): vscode.Disposable | undefined {
  const chatApi = (vscode as unknown as { chat?: Record<string, unknown> }).chat;
  const createChatParticipant = chatApi?.createChatParticipant as
    | ((id: string, handler: unknown) => { iconPath?: unknown } & vscode.Disposable)
    | undefined;

  if (typeof createChatParticipant !== "function") {
    // `vscode.chat` isn't available on this build (older/partial fork) — skip silently.
    return undefined;
  }

  const handler = async (
    request: MinimalChatRequest,
    _chatContext: unknown,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    const prompt = (request.prompt ?? "").trim();
    const command = String(request.command ?? "");

    if (!prompt) {
      stream.markdown(
        "Ask me anything about your code, or use a slash command: `/ask` for a quick question, " +
          "`/plan` to design an approach, or `/agent` to make edits.",
      );
      return;
    }

    try {
      if (command === "agent" || command === "plan") {
        await runAgentTurn({ context, prompt, mode: command as AgentMode, stream, token });
      } else {
        // Default (no command) and `/ask` both get the lightweight, tool-free path.
        await runAskTurn(context, prompt, stream, token);
      }
    } catch (e) {
      if (!token.isCancellationRequested) {
        stream.markdown(`\n\n⚠️ ${(e as Error).message}`);
      }
    }
  };

  const participant = createChatParticipant(CHAT_PARTICIPANT_ID, handler);
  try {
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
  } catch {
    // Non-fatal — some hosts may not support iconPath on chat participants yet.
  }

  return participant;
}

/** `/ask` (and the default, command-less prompt): a single non-agentic completion. */
async function runAskTurn(
  context: vscode.ExtensionContext,
  prompt: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  const quick = await getQuickProvider(context, { maxTokens: 2048, silent: true });
  if (!quick) {
    stream.markdown(
      "⚠️ No NinjaCode API key is configured yet. Run **NinjaCode: Set API Key** and try again.",
    );
    return;
  }

  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());

  await quick.llm.completeStreaming(
    {
      messages: buildMessages(ASK_SYSTEM_PROMPT, prompt),
      model: quick.model,
      maxTokens: quick.maxTokens,
      signal: controller.signal,
    },
    (event) => {
      if (event.type === "text_delta") stream.markdown(event.text);
      else if (event.type === "error" && !controller.signal.aborted) {
        stream.markdown(`\n\n⚠️ ${event.error}`);
      }
    },
  );
}

/** `/plan` and `/agent`: a full tool-using agent run, streamed into the chat response. */
async function runAgentTurn(opts: {
  context: vscode.ExtensionContext;
  prompt: string;
  mode: AgentMode;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
}): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    opts.stream.markdown("⚠️ Open a workspace folder to use NinjaCode's `/plan` or `/agent` commands.");
    return;
  }

  const agent = await createChatParticipantAgent(opts.context, opts.mode, folder.uri.fsPath, opts.stream);
  if (!agent) return;

  opts.token.onCancellationRequested(() => agent.abort());
  const outcome = await agent.run(opts.prompt);
  if (!outcome.completed && !opts.token.isCancellationRequested) {
    opts.stream.markdown(`\n\n⚠️ ${outcome.answer}`);
  }
}

async function createChatParticipantAgent(
  context: vscode.ExtensionContext,
  mode: AgentMode,
  workspaceRoot: string,
  stream: vscode.ChatResponseStream,
): Promise<Agent | undefined> {
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const kind = (cfg.get<ProviderKind>("provider") ?? "anthropic") as ProviderKind;
  const model = cfg.get<string>("model") || undefined;
  const baseUrl = cfg.get<string>("baseUrl") || undefined;
  const approvalMode = cfg.get<ApprovalMode>("approvalMode") ?? "balanced";

  const apiKey = (await getSecretApiKey(context, kind)) ?? "";
  if (kind !== "mock" && kind !== "echo" && !apiKey) {
    stream.markdown(
      "⚠️ No NinjaCode API key is configured yet. Run **NinjaCode: Set API Key** and try again.",
    );
    return undefined;
  }

  const provider = createProvider({
    kind,
    apiKey,
    model,
    baseUrl: kind === "gateway" ? gatewayApiBase(cfg) : baseUrl,
  });
  const modelInfo = getModelInfo(kind, model ?? "");
  const maxTokens = Math.min(8192, modelInfo?.maxOutput ?? 8192);
  const tools = createDefaultToolRegistry();
  const permissions = new PermissionEngine(defaultPermissionPolicy(approvalMode));

  return new Agent({
    provider,
    tools,
    permissions,
    workspaceRoot,
    mode,
    model,
    maxTokens,
    persistSessions: false,
    onEvent: (ev) => onAgentEvent(stream, ev.type, (ev.payload ?? {}) as ChatEventPayload),
    onApproval: async (req) => {
      const choice = await vscode.window.showWarningMessage(
        `NinjaCode wants to run "${req.toolName}" on ${req.target}. ${req.reason}`,
        { modal: true },
        "Allow",
        "Deny",
      );
      return { approved: choice === "Allow" };
    },
  });
}

function onAgentEvent(
  stream: vscode.ChatResponseStream,
  type: string,
  payload: ChatEventPayload,
): void {
  switch (type) {
    case "text_delta":
      stream.markdown(String(payload.text ?? ""));
      break;
    case "tool_start": {
      const name = String(payload.name ?? "tool");
      const target = typeof payload.target === "string" ? payload.target : undefined;
      stream.progress(`Running ${name}${target ? ` (${target})` : ""}…`);
      break;
    }
    case "status":
      stream.progress(String(payload.text ?? ""));
      break;
    case "checkpoint":
      stream.progress("Checkpoint saved.");
      break;
    case "error":
      stream.markdown(`\n\n⚠️ ${String(payload.message ?? payload.text ?? "unknown error")}`);
      break;
    default:
      break;
  }
}
