import path from "node:path";
import { buildAgentRuntime, type ApprovalMode, type AgentMode } from "@ninjacode/core";
import { createProvider, type ProviderKind } from "@ninjacode/providers";
import { setAskUserHandler, setUserActionHandler } from "@ninjacode/tools";
import { consumeLastGatewayError, handleAgentEvent, promptApproval } from "./cliEventHandlers.js";
import { gatewayExitCode } from "./gatewayErrorLines.js";
import { setupAskUserHandlers } from "./cliUserHandlers.js";
import { t } from "./i18n.js";

function resolveApiKey(flags: Record<string, string | boolean>): string {
  return (
    (flags["api-key"] as string | undefined) ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    ""
  );
}

function parseMode(flags: Record<string, string | boolean>): AgentMode {
  const mode = (flags.mode as AgentMode) ?? "agent";
  if (mode !== "agent" && mode !== "plan" && mode !== "ask" && mode !== "debug") {
    console.error(t("cli.invalidMode", { mode }));
    process.exit(1);
  }
  return mode;
}

export async function runTask(flags: Record<string, string | boolean>, task: string): Promise<void> {
  const workspace = path.resolve(String(flags.workspace ?? process.cwd()));
  const kind = (flags.provider as ProviderKind) ?? detectProvider();
  const apiKey = resolveApiKey(flags);

  if (kind !== "mock" && kind !== "echo" && !apiKey) {
    console.error(t("cli.missingApiKey"));
    process.exit(1);
  }

  const provider = createProvider({
    kind,
    apiKey,
    model: flags.model as string | undefined,
    baseUrl: flags["base-url"] as string | undefined,
  });

  const mode = parseMode(flags);
  const approvalMode = (flags.approval as ApprovalMode) ?? (flags.yes ? "autonomous" : "balanced");
  const runtime = await buildAgentRuntime({
    workspaceRoot: workspace,
    provider,
    approvalMode,
    allowAllTools: !!flags.yes,
    agent: {
      mode,
      model: flags.model as string | undefined,
      enableCheckpoints: !flags["no-checkpoints"],
      onEvent: handleAgentEvent,
      onApproval: flags.yes
        ? async () => ({ approved: true })
        : async (req) => promptApproval(req),
    },
  });
  const agent = runtime.createAgent();

  setupAskUserHandlers(setAskUserHandler, setUserActionHandler);

  console.error(
    t("cli.runHeader", { provider: provider.name, mode, workspace }),
  );
  const outcome = await agent.run(task);
  console.log("\n");
  if (!outcome.completed) {
    const gateway = consumeLastGatewayError();
    const exit = gatewayExitCode(gateway);
    if (!gateway) {
      console.error(t("cli.incomplete", { answer: outcome.answer }));
    }
    process.exitCode = exit ?? 2;
  }
}

function detectProvider(): ProviderKind {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.MOONSHOT_API_KEY) return "moonshot";
  if (process.env.GLM_API_KEY) return "glm";
  if (process.env.MISTRAL_API_KEY) return "mistral";
  if (process.env.MAMMOUTH_API_KEY) return "mammouth";
  return "mock";
}
