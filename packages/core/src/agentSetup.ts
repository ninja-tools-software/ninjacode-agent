import type { AgentEventHandler, ApprovalHandler } from "./types.js";
import type { PermissionEngine } from "./permissions.js";
import type { SandboxMode, ToolRegistry } from "@ninjacode/tools";
import type { LlmProvider } from "@ninjacode/providers";
import { loadHooksConfig, HookRunner } from "./hooks.js";
import {
  createUseSkillTool,
  discoverSkills,
  enabledSkills,
  type SkillDefinition,
} from "./skills.js";
import { DebugLogServer, DebugSession } from "./debug.js";
import type { AgentFactory } from "./agentFactory.js";

export async function setupAgentHooks(opts: {
  workspaceRoot: string;
  agentDir: string;
  sandboxMode: SandboxMode;
  permissions: PermissionEngine;
  onApproval?: ApprovalHandler;
  enableWorkspaceHooks?: boolean;
  setHookRunner: (runner: HookRunner) => void;
}): Promise<void> {
  const config =
    opts.enableWorkspaceHooks === false
      ? { enabled: false, hooks: {} }
      : await loadHooksConfig(opts.workspaceRoot).catch(() => ({ enabled: false, hooks: {} }));
  opts.setHookRunner(
    new HookRunner(
      config,
      opts.workspaceRoot,
      opts.permissions,
      opts.onApproval ? (req) => opts.onApproval!({ ...req, arguments: {} }) : undefined,
      { agentDir: opts.agentDir, sandboxMode: opts.sandboxMode },
    ),
  );
}

export async function setupAgentSkills(opts: {
  workspaceRoot: string;
  tools: ToolRegistry;
  provider: LlmProvider;
  agentDir: string;
  createSubAgent: AgentFactory;
  onEvent?: AgentEventHandler;
  setSkills: (skills: SkillDefinition[]) => void;
}): Promise<void> {
  let skills: SkillDefinition[] = [];
  try {
    skills = enabledSkills(await discoverSkills(opts.workspaceRoot));
  } catch {
    skills = [];
  }
  opts.setSkills(skills);
  if (skills.length > 0 && !opts.tools.get("use_skill")) {
    opts.tools.register(
      createUseSkillTool(skills, {
        createAgent: opts.createSubAgent,
        provider: opts.provider,
        workspaceRoot: opts.workspaceRoot,
        agentDir: opts.agentDir,
        onEvent: opts.onEvent,
      }),
    );
  }
}

export async function startAgentDebugServer(opts: {
  agentDir: string;
  setDebugSession: (session: DebugSession) => void;
  setDebugServer: (server: DebugLogServer) => void;
  emitStatus: (text: string) => Promise<void>;
  emitDebugLog: (entry: unknown, count: number) => Promise<void>;
}): Promise<string> {
  const session = new DebugSession(opts.agentDir);
  await session.load();
  opts.setDebugSession(session);
  const server = new DebugLogServer(opts.agentDir, {
    onLog: (entry) => void opts.emitDebugLog(entry, server.count ?? 0),
  });
  opts.setDebugServer(server);
  const url = await server.start();
  await opts.emitStatus(`Debug log server listening at ${url}`);
  return url;
}
