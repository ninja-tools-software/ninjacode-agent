import * as vscode from "vscode";
import {
  Agent,
  clampMaxTokens,
  loadSession,
  type AgentMode,
  type PersistedSession,
} from "@ninjacode/core";
import { getModelInfo, type ModelInfo, type ProviderKind } from "@ninjacode/providers";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import type { ContextUsage } from "../protocol.js";
import { peekCachedGatewayModels } from "../settingsGateway.js";
import type { ChatCore } from "./chatCore.js";
import type { McpService } from "./mcpService.js";
import { resolveContextWindow } from "./runConfigContext.js";

function resolveModelWindow(
  kind: ProviderKind,
  model: string,
  configuredWindow: number,
): { contextWindow?: number; maxTokens: number } {
  const staticInfo = getModelInfo(kind, model);
  let modelInfo: Pick<ModelInfo, "contextWindow" | "defaultContextWindow" | "maxOutput"> | undefined =
    staticInfo;
  if ((!modelInfo || !resolveContextWindow(configuredWindow, modelInfo)) && kind === "gateway") {
    const live = peekCachedGatewayModels()?.find((m) => m.id === model);
    if (live) modelInfo = live;
  }
  const contextWindow = resolveContextWindow(configuredWindow, modelInfo);
  return {
    contextWindow,
    maxTokens: clampMaxTokens(modelInfo?.maxOutput ?? 8192, contextWindow),
  };
}

async function estimateUsage(args: {
  root: string;
  agentDir: string;
  mcp: McpService;
  history: PersistedSession["history"];
  model?: string;
  provider?: string;
  mode?: AgentMode;
}): Promise<ContextUsage | undefined> {
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const kind = (args.provider as ProviderKind | undefined) ?? cfg.get<ProviderKind>("provider") ?? "gateway";
  const model = args.model ?? cfg.get<string>("model") ?? "";
  const mode = args.mode ?? cfg.get<AgentMode>("mode") ?? "agent";
  const configuredWindow = cfg.get<number>("contextWindow") ?? 0;
  const { contextWindow, maxTokens } = resolveModelWindow(kind, model, configuredWindow);
  if (!contextWindow || contextWindow <= 0) return undefined;

  const tools = createDefaultToolRegistry();
  for (const tool of await args.mcp.tools(args.root)) tools.register(tool);

  return Agent.estimateContextForSession({
    workspaceRoot: args.root,
    agentDir: args.agentDir,
    mode,
    history: args.history,
    tools,
    contextWindow,
    maxTokens,
    providerKind: kind,
    model,
  });
}

function postUsage(core: ChatCore, sessionId: string | undefined, usage: ContextUsage): void {
  if (usage.window <= 0) return;
  core.post(sessionId, { type: "context_usage", ...usage });
}

/**
 * Publish a best-effort context meter snapshot for the active session (or a
 * draft baseline when none is selected). Safe to call after hydrate, new
 * session, model/settings changes, or webview reload.
 */
export async function publishActiveContextUsage(core: ChatCore, mcp: McpService): Promise<void> {
  const root = core.workspaceRoot();
  const dir = core.agentDir();
  if (!root || !dir) return;

  const sid = core.activeSessionId;
  try {
    if (sid) {
      const runtime = core.runtimes.get(sid);
      if (runtime?.agent) {
        const usage = await runtime.agent.previewContextUsage();
        postUsage(core, sid, usage);
        return;
      }
      const saved = await loadSession(dir, sid);
      const usage = await estimateUsage({
        root,
        agentDir: dir,
        mcp,
        history: saved?.history ?? [],
        model: saved?.config.model,
        provider: saved?.config.provider,
        mode: saved?.config.mode,
      });
      if (usage) postUsage(core, sid, usage);
      return;
    }

    const usage = await estimateUsage({
      root,
      agentDir: dir,
      mcp,
      history: [],
    });
    if (usage) postUsage(core, undefined, usage);
  } catch {
    // Best-effort UI affordance — never block session flows.
  }
}
