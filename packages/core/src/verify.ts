import fs from "node:fs/promises";
import path from "node:path";
import type { ToolContext } from "@ninjacode/tools";
import { collectDiagnostics, formatDiagnostics } from "@ninjacode/tools";
import { nodeProcessRunner } from "./nodePorts.js";
import type { ProcessRunner } from "./ports.js";

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

  if (config.requireCleanDiagnostics !== false && modifiedPaths.length > 0) {
    const diags = await collectDiagnostics(ctx, modifiedPaths);
    const errors = diags.filter((d) => d.severity === "error");
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
    });
    if (result.code !== 0) {
      const output = (result.stdout + result.stderr).slice(0, 4000);
      messages.push(`Verify command failed (exit ${result.code}): ${trimmed}\n${output}`);
    }
  }

  return { ok: messages.length === 0, messages };
}
