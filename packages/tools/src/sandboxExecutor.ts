import type { SandboxMode } from "./types.js";
import {
  assertSandboxReady,
  buildExecutionEnv,
  sandboxCommand,
  type SandboxCommandOptions,
  type SandboxedCommand,
} from "./sandbox.js";

export interface SandboxExecutorOptions {
  workspaceRoot: string;
  agentDir: string;
  mode: SandboxMode;
  sessionId?: string;
  allowNetwork?: boolean;
}

/**
 * Isolates the OS execution boundary. Prefer the `srt --settings` CLI when
 * `@anthropic-ai/sandbox-runtime` is installed; otherwise Seatbelt/bubblewrap.
 */
export class SandboxExecutor {
  constructor(private readonly options: SandboxExecutorOptions) {
    assertSandboxReady(options.mode);
  }

  env(explicit: Record<string, string> = {}): NodeJS.ProcessEnv {
    return buildExecutionEnv(process.env, explicit);
  }

  wrap(command: string, args: string[], extra: Partial<SandboxCommandOptions> = {}): SandboxedCommand {
    return sandboxCommand({
      command,
      args,
      cwd: extra.cwd ?? this.options.workspaceRoot,
      workspaceRoot: this.options.workspaceRoot,
      agentDir: this.options.agentDir,
      mode: this.options.mode,
      allowNetwork: extra.allowNetwork ?? this.options.allowNetwork,
      sessionId: this.options.sessionId,
      env: extra.env ?? this.env(),
      platform: extra.platform,
    });
  }
}
