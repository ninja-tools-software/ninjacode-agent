import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CheckpointFailure } from "@ninjacode/core";
import type { GatewayErrorInfo } from "@ninjacode/providers";
import { gatewayErrorLines } from "./gatewayErrorLines.js";
import { t } from "./i18n.js";

/** Last typed gateway error seen during the current run (for exit codes). */
let lastGatewayError: GatewayErrorInfo | undefined;

export function consumeLastGatewayError(): GatewayErrorInfo | undefined {
  const info = lastGatewayError;
  lastGatewayError = undefined;
  return info;
}

function checkpointStageText(stage: CheckpointFailure["stage"]): string {
  switch (stage) {
    case "init":
      return t("cli.checkpointStage.init");
    case "create":
      return t("cli.checkpointStage.create");
    case "emit":
      return t("cli.checkpointStage.emit");
  }
}

export async function promptApproval(req: {
  toolName: string;
  target: string;
  reason: string;
  danger?: boolean;
}): Promise<{ approved: boolean; remember?: boolean }> {
  const rl = createInterface({ input, output });
  const args = { tool: req.toolName, target: req.target, reason: req.reason };
  try {
    // An irreversible call is decided on its own every time: no "always", and
    // no implicit yes on a bare Enter.
    const answer = await rl.question(
      t(req.danger ? "cli.approveDangerPrompt" : "cli.approvePrompt", args),
    );
    const a = answer.trim().toLowerCase();
    if (req.danger) return { approved: a === "y" || a === "yes" };
    if (a === "a" || a === "always") return { approved: true, remember: true };
    if (a === "y" || a === "yes" || a === "") return { approved: true };
    return { approved: false };
  } finally {
    rl.close();
  }
}

export async function handleAgentEvent(ev: { type: string; payload: unknown }): Promise<void> {
  if (ev.type === "thinking") {
    process.stderr.write(`\n⟳ turn ${(ev.payload as { turn: number }).turn}…\n`);
  } else if (ev.type === "text_delta") {
    process.stdout.write((ev.payload as { text: string }).text);
  } else if (ev.type === "tool_start") {
    const p = ev.payload as { name: string; target?: string };
    process.stderr.write(`\n→ ${p.name}${p.target ? ` (${p.target})` : ""}\n`);
  } else if (ev.type === "tool_end") {
    const p = ev.payload as { name: string; error?: string };
    if (p.error) process.stderr.write(`✗ ${p.name}: ${p.error}\n`);
    else process.stderr.write(`✓ ${p.name}\n`);
  } else if (ev.type === "checkpoint") {
    const p = ev.payload as { id: string; label: string };
    process.stderr.write(`⊕ checkpoint ${p.label} (${p.id.slice(0, 8)})\n`);
  } else if (ev.type === "checkpoint_error") {
    const p = ev.payload as CheckpointFailure;
    process.stderr.write(
      `${t("cli.checkpointFailed", {
        stage: checkpointStageText(p.stage),
        message: p.message,
      })}\n`,
    );
  } else if (ev.type === "routing") {
    const p = ev.payload as { model: string; label?: string; reason?: string };
    const reason = p.reason ? ` (${p.reason})` : "";
    process.stderr.write(t("cli.routing", { model: p.label ?? p.model, reason }));
  } else if (ev.type === "error") {
    const p = ev.payload as { message: string; gateway?: GatewayErrorInfo };
    if (p.gateway) {
      lastGatewayError = p.gateway;
      for (const line of gatewayErrorLines(p.gateway)) {
        process.stderr.write(`${line}\n`);
      }
      return;
    }
    process.stderr.write(`\n⚠ ${p.message}\n`);
  }
}
