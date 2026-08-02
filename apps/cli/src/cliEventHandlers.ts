import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { t } from "./i18n.js";

export async function promptApproval(
  toolName: string,
  target: string,
  reason: string,
): Promise<{ approved: boolean; remember?: boolean }> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      t("cli.approvePrompt", { tool: toolName, target, reason }),
    );
    const a = answer.trim().toLowerCase();
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
  } else if (ev.type === "routing") {
    const p = ev.payload as { model: string; label?: string; reason?: string };
    const reason = p.reason ? ` (${p.reason})` : "";
    process.stderr.write(t("cli.routing", { model: p.label ?? p.model, reason }));
  }
}
