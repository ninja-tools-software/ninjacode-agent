import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  Agent,
  buildAgentRuntime,
  createDeviceOAuthHost,
  createMemorySecretStore,
  createOAuthAuthPort,
  DEFAULT_RUN_TIMEOUT_MS,
  loadMcpConfig,
  loadMcpTools,
  type CheckpointFailure,
  type ToolEndEventPayload,
  type ToolStartEventPayload,
} from "@ninjacode/core";
import {
  createProvider,
  type GatewayErrorInfo,
  type ProviderKind,
} from "@ninjacode/providers";
import type { SandboxMode } from "@ninjacode/tools";
import { t } from "./i18n.js";
import type { Session } from "./sessionStore.js";
import { notify } from "./rpcTransport.js";

function assertDebugModeUnsupported(mode: string | undefined): void {
  if (mode === "debug") {
    throw new Error(
      "Debug mode is not supported in the ACP agent yet. Use the VS Code extension or CLI (`--mode debug`).",
    );
  }
}

function configuredSandboxMode(): SandboxMode {
  const configured = process.env.NINJACODE_SANDBOX;
  return configured === "read-only" ||
    configured === "workspace-write" ||
    configured === "danger-full-access"
    ? configured
    : "workspace-write";
}

function gatewayErrorText(info: GatewayErrorInfo): string {
  switch (info.code) {
    case "insufficient_credits":
      return info.partial
        ? t("acp.gateway.creditsPartial")
        : t("acp.gateway.credits");
    case "rate_limited":
      return t("acp.gateway.rateLimited");
    case "model_not_priced":
      return t("acp.gateway.modelNotPriced", { model: info.model ?? "model" });
    case "model_not_in_catalog":
      return t("acp.gateway.modelNotInCatalog", {
        model: info.model ?? "model",
        catalog: info.catalog ?? "plan",
      });
    case "account_suspended":
      return t("acp.gateway.accountSuspended");
    case "unauthorized":
      return t("acp.gateway.unauthorized");
    case "upstream_timeout":
      return t("acp.gateway.upstreamTimeout");
  }
}

function checkpointStageText(stage: CheckpointFailure["stage"]): string {
  switch (stage) {
    case "init":
      return t("acp.checkpointStage.init");
    case "create":
      return t("acp.checkpointStage.create");
    case "emit":
      return t("acp.checkpointStage.emit");
  }
}

export function createAgentEventHandler(sessionId: string) {
  return async (ev: { type: string; payload: unknown }) => {
    if (ev.type === "text_delta") {
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: (ev.payload as { text: string }).text },
        },
      });
    } else if (ev.type === "tool_start") {
      const p = ev.payload as ToolStartEventPayload;
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: p.id,
          title: p.name,
          status: "in_progress",
          rawInput: p.arguments,
        },
      });
    } else if (ev.type === "tool_end") {
      const p = ev.payload as ToolEndEventPayload;
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: p.id,
          status: p.error ? "failed" : "completed",
        },
      });
    } else if (ev.type === "checkpoint_error") {
      const p = ev.payload as CheckpointFailure;
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `\n${t("acp.checkpointFailed", {
              stage: checkpointStageText(p.stage),
              message: p.message,
            })}\n`,
          },
        },
      });
    } else if (ev.type === "error") {
      const p = ev.payload as { message: string; gateway?: GatewayErrorInfo };
      const text = p.gateway ? gatewayErrorText(p.gateway) : p.message;
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `\n${text}\n` },
        },
      });
    }
  };
}

function isReadOnlyTool(toolName: string): boolean {
  return (
    toolName.startsWith("read") ||
    toolName === "grep" ||
    toolName === "glob" ||
    toolName === "list_dir"
  );
}

function createApprovalHandler(sessionId: string, sessions: Map<string, Session>, yolo: boolean) {
  return async (req: { toolName: string; target: string; arguments?: Record<string, unknown> }) => {
    const session = sessions.get(sessionId);
    if (!session) return { approved: false };
    if (isReadOnlyTool(req.toolName) || yolo) return { approved: true };

    return new Promise<{ approved: boolean; remember?: boolean }>((resolve) => {
      session.pendingPermission = { resolve };
      notify("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: randomUUID(),
          title: req.toolName,
          kind: "other",
          status: "pending",
          rawInput: { target: req.target, ...req.arguments },
        },
        options: [
          { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
          { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
          { optionId: "reject_once", name: "Reject", kind: "reject_once" },
        ],
      });
      setTimeout(() => {
        if (session.pendingPermission?.resolve === resolve) {
          session.pendingPermission = undefined;
          resolve({ approved: false });
        }
      }, 300_000);
    });
  };
}

export async function createAgentFor(
  cwd: string,
  sessionId: string,
  sessions: Map<string, Session>,
): Promise<Agent> {
  const kind = (process.env.NINJACODE_PROVIDER as ProviderKind) || "anthropic";
  const apiKey =
    process.env.NINJACODE_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.MAMMOUTH_API_KEY ||
    "";
  const provider = createProvider({
    kind: apiKey ? kind : "mock",
    apiKey,
    model: process.env.NINJACODE_MODEL,
    baseUrl: process.env.NINJACODE_BASE_URL,
  });

  assertDebugModeUnsupported(process.env.NINJACODE_MODE);
  const yolo = process.env.NINJACODE_YOLO === "1";
  const sandboxMode = configuredSandboxMode();

  const runtime = await buildAgentRuntime({
    workspaceRoot: cwd,
    provider,
    approvalMode: yolo ? "autonomous" : "balanced",
    allowAllTools: yolo,
    configureTools: async (tools) => {
      const mcpConfigs = await loadMcpConfig(cwd);
      if (mcpConfigs.length) {
        const { tools: mcpTools } = await loadMcpTools(mcpConfigs, {
          workspaceRoot: cwd,
          agentDir: path.join(cwd, ".ninjacode"),
          sandboxMode,
          auth: createOAuthAuthPort(
            createDeviceOAuthHost({
              onUserCode: async ({ userCode, verificationUri }) => {
                process.stderr.write(`MCP OAuth: visit ${verificationUri} and enter ${userCode}\n`);
              },
            }),
            createMemorySecretStore(),
          ),
        });
        for (const t of mcpTools) tools.register(t);
      }
    },
    agent: {
      agentDir: path.join(cwd, ".ninjacode"),
      mode: "agent",
      sandboxMode,
      runTimeoutMs: Number(process.env.NINJACODE_RUN_TIMEOUT_MS) || DEFAULT_RUN_TIMEOUT_MS,
      sessionId,
      enableCheckpoints: true,
      onEvent: createAgentEventHandler(sessionId),
      onApproval: createApprovalHandler(sessionId, sessions, yolo),
    },
  });

  return runtime.createAgent();
}
