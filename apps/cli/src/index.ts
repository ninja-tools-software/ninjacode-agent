#!/usr/bin/env node
import path from "node:path";
import { buildAgentRuntime } from "@ninjacode/core";
import { parseArgs, usage } from "./cliArgs.js";
import { resolveLocale, setLocale, t } from "./i18n.js";
import { runTask } from "./runTask.js";

async function runDemo(flags: Record<string, string | boolean>): Promise<void> {
  const { MockProvider } = await import("@ninjacode/providers");
  const workspace = path.resolve(String(flags.workspace ?? process.cwd()));
  const runtime = await buildAgentRuntime({
    workspaceRoot: workspace,
    provider: new MockProvider([
      {
        text: "Listing workspace…",
        toolCalls: [{ id: "1", name: "list_dir", arguments: { path: "." } }],
      },
      { text: "Demo complete. NinjaCode harness is ready." },
    ]),
    approvalMode: "autonomous",
    allowAllTools: true,
    agent: {
      enableCheckpoints: false,
      onEvent: async (ev) => {
        if (ev.type === "text_delta") process.stdout.write((ev.payload as { text: string }).text);
        if (ev.type === "tool_start") {
          process.stderr.write(`\n→ ${(ev.payload as { name: string }).name}\n`);
        }
      },
    },
  });
  const agent = runtime.createAgent();
  console.error(t("cli.demoHeader"));
  const outcome = await agent.run("Demo: list the workspace.");
  console.log("\n\n" + (outcome.completed ? "✓" : "✗"), outcome.answer.slice(0, 200));
}

async function main(): Promise<void> {
  const { cmd, flags, positional } = parseArgs(process.argv.slice(2));
  setLocale(resolveLocale(flags));
  if (cmd === "help" || cmd === "--help" || cmd === "-h") usage();

  if (cmd === "demo") {
    await runDemo(flags);
    return;
  }

  if (cmd === "run") {
    const task = positional.join(" ").trim();
    if (!task) usage();
    await runTask(flags, task);
    return;
  }

  if (cmd === "eval") {
    const { runEvals } = await import("./eval.js");
    await runEvals();
    return;
  }

  usage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
