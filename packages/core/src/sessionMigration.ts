import type { Message } from "@ninjacode/providers";
import { SessionArtifactStore } from "./sessionArtifacts.js";
import { sessionEventLog } from "./sessionEventLog.js";
import type { PersistedSession } from "./sessions.js";
import type { ToolInvocation } from "./types.js";

function invocationByCallId(session: PersistedSession): Map<string, ToolInvocation> {
  const byId = new Map<string, ToolInvocation>();
  for (const turn of session.turns) {
    for (const invocation of turn.toolInvocations) {
      byId.set(invocation.toolCall.id, invocation);
    }
  }
  return byId;
}

async function archiveLegacyToolMessage(
  store: SessionArtifactStore,
  message: Message,
  invocation: ToolInvocation | undefined,
): Promise<{ artifactId: string; recoverable: boolean }> {
  const content = invocation?.output ?? message.content;
  const artifact = await store.putText(content, {
    kind: "legacy_observation",
    toolName: invocation?.toolCall.name ?? message.name,
    toolCallId: invocation?.toolCall.id ?? message.toolCallId,
  });
  return { artifactId: artifact.id, recoverable: Boolean(invocation) };
}

/**
 * Creates v2 sidecars lazily without rewriting the legacy session JSON. The
 * next normal save persists contextVersion/modelView.
 */
export async function prepareLegacySessionContext(
  agentDir: string,
  session: PersistedSession,
): Promise<PersistedSession> {
  if (session.contextVersion === 2) return session;
  const log = sessionEventLog(agentDir, session.config.id);
  if ((await log.readAll(1)).length > 0) {
    return { ...session, contextVersion: 2, modelView: session.history };
  }
  const store = new SessionArtifactStore(agentDir, session.config.id);
  const invocations = invocationByCallId(session);
  for (const message of session.history) {
    if (message.role === "user") {
      await log.append("legacy_message", { role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      await log.append("legacy_message", {
        role: "assistant",
        content: message.content,
        toolCalls: message.toolCalls ?? [],
      });
      continue;
    }
    if (message.role !== "tool") continue;
    const archived = await archiveLegacyToolMessage(
      store,
      message,
      message.toolCallId ? invocations.get(message.toolCallId) : undefined,
    );
    await log.append("tool_result", {
      toolCallId: message.toolCallId ?? "",
      toolName: message.name ?? "",
      artifactId: archived.artifactId,
      migratedFromV1: true,
    });
    if (!archived.recoverable) {
      await log.append("legacy_unrecoverable", {
        toolCallId: message.toolCallId ?? "",
        reason: "The v1 session had already reduced this observation before migration.",
      });
    }
  }
  return { ...session, contextVersion: 2, modelView: session.history };
}
