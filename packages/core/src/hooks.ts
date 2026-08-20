import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildExecutionEnv,
  classifyShellDanger,
  sandboxCommand,
  shellGrantPolicy,
  shellGrantScopes,
  type SandboxMode,
  type Tool,
} from "@ninjacode/tools";
import type { PermissionEngine } from "./permissions.js";

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop";

export interface HookDefinition {
  /** Regex tested against the tool name for PreToolUse/PostToolUse; ignored for Stop. Defaults to match-all. */
  matcher?: string;
  command: string;
  timeoutMs?: number;
}

export interface HooksFile {
  /** Hooks execute arbitrary shell commands, so they're opt-in: absent/false disables the whole subsystem. */
  enabled?: boolean;
  hooks?: Partial<Record<HookEvent, HookDefinition[]>>;
}

export interface HookRunResult {
  event: HookEvent;
  command: string;
  ran: boolean;
  /** True when the hook exited with code 2, or when a PreToolUse hook was
   * denied / lacked an approval handler (fail-closed: the tool must not run). */
  blocked: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /** Why the hook didn't run (denied by policy, declined approval, spawn error…). */
  reason?: string;
}

export interface HookExecInput {
  event: HookEvent;
  sessionId: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export type HookApprovalHandler = (req: {
  toolName: string;
  target: string;
  reason: string;
}) => Promise<{ approved: boolean; remember?: boolean }>;

interface HookExecutionOptions {
  agentDir: string;
  sandboxMode: SandboxMode;
}

const HOOKS_CONFIG_CANDIDATES = [
  path.join(".ninjacode", "hooks.json"),
  path.join(".ninjacode", "hooks.jsonc"),
];

function stripJsonComments(s: string): string {
  return s.replace(/^\s*\/\/.*$/gm, "");
}

export async function loadHooksConfig(workspaceRoot: string): Promise<HooksFile> {
  for (const rel of HOOKS_CONFIG_CANDIDATES) {
    try {
      const raw = await fs.readFile(path.join(workspaceRoot, rel), "utf8");
      const parsed = JSON.parse(stripJsonComments(raw)) as HooksFile;
      return { enabled: false, hooks: {}, ...parsed };
    } catch {
      // try next candidate
    }
  }
  return { enabled: false, hooks: {} };
}

/** Synthetic "tool" used purely so hook commands flow through the same PermissionEngine as run_shell. */
function hookAsShellTool(name: string, command: string): Tool {
  return {
    name,
    description: "hook",
    risk: "shell",
    inputSchema: {},
    target: () => command,
    riskFor: () => (classifyShellDanger(command) ? "destructive" : "shell"),
    grantScopes: () => shellGrantScopes(command),
    grantPolicy: () => shellGrantPolicy(command),
    execute: async () => ({ output: "" }),
  };
}

function matchesTool(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === "*") return true;
  try {
    return new RegExp(`^(${matcher})$`).test(toolName);
  } catch {
    return matcher === toolName;
  }
}

function stopHookProcess(child: ReturnType<typeof spawn>): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // fall back to direct child
    }
  }
  child.kill("SIGTERM");
}

/**
 * Executes PreToolUse / PostToolUse / Stop hook commands declared in
 * `.ninjacode/hooks.json`. Hooks are disabled by default and, when enabled,
 * are gated by the exact same PermissionEngine + approval flow used for the
 * `run_shell` tool (hook commands carry "shell" risk) — so a "strict" policy
 * still prompts before ever running one.
 */
export class HookRunner {
  constructor(
    private readonly config: HooksFile,
    private readonly workspaceRoot: string,
    private readonly permissions: PermissionEngine,
    private readonly onApproval?: HookApprovalHandler,
    private readonly execution: HookExecutionOptions = {
      agentDir: path.join(workspaceRoot, ".ninjacode"),
      sandboxMode: "danger-full-access",
    },
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.enabled) && Object.keys(this.config.hooks ?? {}).length > 0;
  }

  private definitionsFor(event: HookEvent): HookDefinition[] {
    if (!this.enabled) return [];
    return this.config.hooks?.[event] ?? [];
  }

  async run(input: HookExecInput, signal?: AbortSignal): Promise<HookRunResult[]> {
    const defs = this.definitionsFor(input.event);
    if (defs.length === 0) return [];
    const results: HookRunResult[] = [];
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]!;
      if (input.toolName && !matchesTool(def.matcher, input.toolName)) continue;
      results.push(await this.runOne(def, i, input, signal));
    }
    return results;
  }

  private async runOne(
    def: HookDefinition,
    index: number,
    input: HookExecInput,
    signal?: AbortSignal,
  ): Promise<HookRunResult> {
    const toolName = `hook:${input.event}:${index}`;
    const target = def.command;
    const tool = hookAsShellTool(toolName, target);
    const scopes = tool.grantScopes?.({}) ?? [];
    const policy = tool.grantPolicy?.({}) ?? "exact";
    const risk = tool.riskFor?.({}) ?? tool.risk;
    const decision = this.permissions.evaluate(tool, target, {
      scopes,
      risk,
      grantPolicy: policy,
    });

    if (!decision.allowed) {
      return {
        event: input.event,
        command: def.command,
        ran: false,
        blocked: input.event === "PreToolUse",
        reason: decision.reason,
      };
    }

    if (decision.needsApproval) {
      if (!this.onApproval) {
        return {
          event: input.event,
          command: def.command,
          ran: false,
          blocked: input.event === "PreToolUse",
          reason: "approval required but no handler configured",
        };
      }
      const approval = await this.onApproval({
        toolName,
        target,
        reason: `hook (${input.event}): ${decision.reason}`,
      });
      if (!approval.approved) {
        return {
          event: input.event,
          command: def.command,
          ran: false,
          blocked: input.event === "PreToolUse",
          reason: "denied by user",
        };
      }
      if (approval.remember && policy !== "never") {
        if (policy === "exact" || scopes.length === 0) {
          this.permissions.grant(toolName, target);
        } else {
          for (const scope of scopes) this.permissions.grant(toolName, scope);
        }
      }
    }

    return this.exec(def, input, signal);
  }

  private exec(def: HookDefinition, input: HookExecInput, signal?: AbortSignal): Promise<HookRunResult> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        const env = buildExecutionEnv(process.env, {
          NINJACODE_HOOK_EVENT: input.event,
          NINJACODE_TOOL_NAME: input.toolName ?? "",
          NINJACODE_SESSION_ID: input.sessionId,
        });
        const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
        const args =
          process.platform === "win32" ? ["/d", "/s", "/c", def.command] : ["-lc", def.command];
        const wrapped = sandboxCommand({
          command: shell,
          args,
          cwd: this.workspaceRoot,
          workspaceRoot: this.workspaceRoot,
          agentDir: this.execution.agentDir,
          mode: this.execution.sandboxMode,
          env,
        });
        child = spawn(wrapped.command, wrapped.args, {
          cwd: this.workspaceRoot,
          env,
          signal,
          detached: process.platform !== "win32",
        });
      } catch (e) {
        resolve({
          event: input.event,
          command: def.command,
          ran: false,
          blocked: false,
          reason: (e as Error).message,
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      const payload = JSON.stringify({
        event: input.event,
        toolName: input.toolName,
        arguments: input.arguments,
        output: input.output?.slice(0, 4000),
        error: input.error,
      });
      // A hook that never reads its stdin closes the pipe early. The EPIPE that follows is
      // harmless, but without a listener it escapes as an uncaught exception.
      child.stdin?.on("error", () => undefined);
      child.stdin?.write(payload);
      child.stdin?.end();
      child.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
      child.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));

      const timer = setTimeout(() => stopHookProcess(child), def.timeoutMs ?? 30_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          event: input.event,
          command: def.command,
          ran: true,
          blocked: code === 2,
          exitCode: code ?? undefined,
          stdout: stdout.slice(0, 4000),
          stderr: stderr.slice(0, 4000),
        });
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ event: input.event, command: def.command, ran: false, blocked: false, reason: e.message });
      });
    });
  }
}
