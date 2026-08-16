import { runShell } from "../workspace.js";
import type { AgentAdapter, BenchTask } from "../types.js";

export interface CliAdapterConfig {
  /** Display name in reports, e.g. "claude-code" or "codex". */
  name: string;
  /**
   * Command template. "{prompt}" is replaced by the shell-quoted task prompt.
   * The command runs with the temp workspace as cwd.
   */
  command: string;
  /** Extra environment variables for the subprocess. */
  env?: Record<string, string>;
}

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * Generic adapter for competitor CLIs run in headless mode. Examples (see agents.example.json):
 *   Claude Code:  claude -p {prompt} --permission-mode acceptEdits
 *   Codex CLI:    codex exec --full-auto {prompt}
 *   Cursor CLI:   cursor-agent -p {prompt} --force
 * Only wall-time, diff stats and pass/fail are comparable across CLIs; token/cost
 * telemetry is NinjaCode-only (in-process adapter).
 */
export function createCliAdapter(config: CliAdapterConfig): AgentAdapter {
  return {
    name: config.name,
    async run(task: BenchTask, workspaceDir: string, timeoutMs: number) {
      const cmd = config.command.replaceAll("{prompt}", shellQuote(task.prompt));
      const prevEnv: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(config.env ?? {})) {
        prevEnv[k] = process.env[k];
        process.env[k] = v;
      }
      try {
        const { ok, timedOut, output } = await runShell(cmd, workspaceDir, timeoutMs);
        return {
          metrics: { telemetryAvailable: false },
          outputTail: output,
          timedOut,
          agentError: !ok && !timedOut ? "CLI exited non-zero" : undefined,
        };
      } finally {
        for (const [k, v] of Object.entries(prevEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    },
  };
}
