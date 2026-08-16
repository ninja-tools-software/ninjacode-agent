import fs from "node:fs/promises";
import path from "node:path";
import type { DiagnosticEntry, ToolContext } from "@ninjacode/tools";
import { collectDiagnostics, formatDiagnostics } from "@ninjacode/tools";
import { nodeProcessRunner } from "./nodePorts.js";
import type { ProcessRunner } from "./ports.js";
import { condenseVerifyOutput } from "./verifyOutput.js";

export interface VerifyConfig {
  /** Shell commands run after edits; all must exit 0. */
  commands?: string[];
  /** When true, block completion if workspace has error-level diagnostics. */
  requireCleanDiagnostics?: boolean;
}

const DEFAULT_CONFIG: VerifyConfig = {
  requireCleanDiagnostics: true,
};

export async function loadVerifyConfig(agentDir: string): Promise<VerifyConfig> {
  const candidates = [
    path.join(agentDir, "verify.json"),
    path.join(agentDir, "verify.jsonc"),
  ];
  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const json = raw.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(json) as VerifyConfig;
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      // try next
    }
  }
  return DEFAULT_CONFIG;
}

export interface VerificationResult {
  ok: boolean;
  messages: string[];
  diagnostics: {
    checked: boolean;
    entries: DiagnosticEntry[];
  };
  commands: VerificationCommandResult[];
  /** True when no deterministic local signal was available. */
  ambiguous: boolean;
}

export interface VerificationCommandResult {
  command: string;
  exitCode: number;
  passed: boolean;
  output: string;
}

export interface RunVerificationOptions {
  processRunner?: ProcessRunner;
}

export async function runVerification(
  ctx: ToolContext,
  config: VerifyConfig,
  modifiedPaths: string[],
  opts: RunVerificationOptions = {},
): Promise<VerificationResult> {
  const runner = opts.processRunner ?? nodeProcessRunner;
  const messages: string[] = [];
  const commands: VerificationCommandResult[] = [];
  const shouldCheckDiagnostics =
    config.requireCleanDiagnostics !== false && modifiedPaths.length > 0;
  let diagnostics: DiagnosticEntry[] = [];

  if (shouldCheckDiagnostics) {
    diagnostics = await collectDiagnostics(ctx, modifiedPaths);
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      messages.push(
        `Diagnostics found ${errors.length} error(s) in modified files:\n${formatDiagnostics(errors)}`,
      );
    }
  }

  for (const cmd of config.commands ?? []) {
    const trimmed = cmd.trim();
    if (!trimmed) continue;
    const result = await runner.run(trimmed, [], {
      cwd: ctx.workspaceRoot,
      signal: ctx.signal,
      shell: true,
      sandbox: {
        workspaceRoot: ctx.workspaceRoot,
        agentDir: ctx.agentDir,
        mode: ctx.sandboxMode ?? "workspace-write",
      },
    });
    const output = condenseVerifyOutput(result.stdout, result.stderr);
    commands.push({
      command: trimmed,
      exitCode: result.code,
      passed: result.code === 0,
      output,
    });
    if (result.code !== 0) {
      messages.push(`Verify command failed (exit ${result.code}): ${trimmed}\n${output}`);
    }
  }

  return {
    ok: messages.length === 0,
    messages,
    diagnostics: {
      checked: shouldCheckDiagnostics,
      entries: diagnostics,
    },
    commands,
    ambiguous: !shouldCheckDiagnostics && commands.length === 0,
  };
}
