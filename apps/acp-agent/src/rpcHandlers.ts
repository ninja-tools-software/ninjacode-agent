import { randomUUID } from "node:crypto";
import { createAgentFor } from "./agentFactory.js";
import { t } from "./i18n.js";
import { respond, respondError } from "./rpcTransport.js";
import { sessions } from "./sessionStore.js";

function extractPrompt(params?: Record<string, unknown>): string {
  if (!params) return "";
  if (typeof params.prompt === "string") return params.prompt;
  const prompt = params.prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text);
        }
        if (block && typeof block === "object" && "type" in block) {
          const b = block as { type: string; text?: string };
          if (b.type === "text") return b.text ?? "";
        }
        return "";
      })
      .join("");
  }
  if (typeof params.text === "string") return params.text;
  return JSON.stringify(params);
}

function handleInitialize(id: number | string | undefined): void {
  respond(id, {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: false, audio: false, embeddedContext: true },
    },
    agentInfo: { name: "NinjaCode", version: "0.1.0" },
  });
}

async function handleSessionNew(
  id: number | string | undefined,
  params?: Record<string, unknown>,
): Promise<void> {
  const cwd = String(params?.cwd ?? process.cwd());
  const sessionId = `sess_${randomUUID()}`;
  const agent = await createAgentFor(cwd, sessionId, sessions);
  sessions.set(sessionId, { id: sessionId, cwd, agent });
  respond(id, { sessionId });
}

async function handleSessionLoad(
  id: number | string | undefined,
  params?: Record<string, unknown>,
): Promise<void> {
  const sessionId = String(params?.sessionId ?? "");
  const cwd = String(params?.cwd ?? process.cwd());
  if (!sessions.has(sessionId)) {
    const agent = await createAgentFor(cwd, sessionId, sessions);
    sessions.set(sessionId, { id: sessionId, cwd, agent });
  }
  respond(id, { sessionId });
}

async function handleSessionPrompt(
  id: number | string | undefined,
  params?: Record<string, unknown>,
): Promise<void> {
  const sessionId = String(params?.sessionId ?? "");
  const session = sessions.get(sessionId);
  if (!session) {
    respondError(id, -32001, t("acp.unknownSession"));
    return;
  }
  const prompt = extractPrompt(params);
  try {
    const outcome = await session.agent.run(prompt);
    respond(id, { stopReason: outcome.completed ? "end_turn" : "max_tokens" });
  } catch (e) {
    respondError(id, -32000, (e as Error).message);
  }
}

function handleSessionSetMode(id: number | string | undefined, params?: Record<string, unknown>): void {
  const mode = String(params?.mode ?? "");
  if (mode === "debug") {
    respondError(id, -32002, t("acp.debugUnsupported"));
    return;
  }
  respondError(id, -32002, t("acp.modeUnsupported", { mode: mode || "unknown" }));
}

function handleSessionCancel(id: number | string | undefined, params?: Record<string, unknown>): void {
  const sessionId = String(params?.sessionId ?? "");
  sessions.get(sessionId)?.agent.abort();
  respond(id, {});
}

function handlePermissionResponse(
  id: number | string | undefined,
  params?: Record<string, unknown>,
): void {
  const sessionId = String(params?.sessionId ?? "");
  const session = sessions.get(sessionId);
  const optionId = String(
    (params as { outcome?: { outcome?: string; optionId?: string } })?.outcome?.optionId ??
      params?.optionId ??
      "",
  );
  if (session?.pendingPermission) {
    const approved = optionId.startsWith("allow");
    const remember = optionId === "allow_always";
    session.pendingPermission.resolve({ approved, remember });
    session.pendingPermission = undefined;
  }
  respond(id, {});
}

const handlers: Record<
  string,
  (id: number | string | undefined, params?: Record<string, unknown>) => void | Promise<void>
> = {
  initialize: handleInitialize,
  authenticate: (id) => respond(id, {}),
  "session/new": handleSessionNew,
  "session/load": handleSessionLoad,
  "session/prompt": handleSessionPrompt,
  "session/set_mode": handleSessionSetMode,
  "session/cancel": handleSessionCancel,
  "session/permission_response": handlePermissionResponse,
  "session/request_permission_response": handlePermissionResponse,
};

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export async function handle(msg: JsonRpcRequest): Promise<void> {
  const handler = handlers[msg.method];
  if (handler) {
    await handler(msg.id, msg.params);
    return;
  }
  if (msg.id !== undefined) respondError(msg.id, -32601, t("acp.methodNotFound", { method: msg.method }));
}
