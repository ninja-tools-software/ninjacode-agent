import path from "node:path";
import { randomUUID } from "node:crypto";
import { Agent, buildAgentRuntime, loadMcpConfig, loadMcpTools } from "@ninjacode/core";
import { createProvider, type ProviderKind } from "@ninjacode/providers";
import type { Session } from "./sessionStore.js";
import { notify } from "./rpcTransport.js";

function assertDebugModeUnsupported(mode: string | undefined): void {
  if (mode === "debug") {
    throw new Error(
      "Debug mode is not supported in the ACP agent yet. Use the VS Code extension or CLI (`--mode debug`).",
    );
  }
}

function createAgentEventHandler(sessionId: string) {
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
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: randomUUID(),
          title: (ev.payload as { name: string }).name,
          status: "in_progress",
          rawInput: (ev.payload as { arguments?: unknown }).arguments,
        },
      });
    } else if (ev.type === "tool_end") {
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          status: (ev.payload as { error?: string }).error ? "failed" : "completed",
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

  const runtime = await buildAgentRuntime({
    workspaceRoot: cwd,
    provider,
    approvalMode: yolo ? "autonomous" : "balanced",
    allowAllTools: yolo,
    configureTools: async (tools) => {
      const mcpConfigs = await loadMcpConfig(cwd);
      if (mcpConfigs.length) {
        const { tools: mcpTools } = await loadMcpTools(mcpConfigs);
        for (const t of mcpTools) tools.register(t);
      }
    },
    agent: {
      agentDir: path.join(cwd, ".ninjacode"),
      mode: "agent",
      sessionId,
      enableCheckpoints: true,
      onEvent: createAgentEventHandler(sessionId),
      onApproval: createApprovalHandler(sessionId, sessions, yolo),
    },
  });

  return runtime.createAgent();
}
