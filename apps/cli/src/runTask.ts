import path from "node:path";
import {
  buildAgentRuntime,
  createDeviceOAuthHost,
  createMemorySecretStore,
  createOAuthAuthPort,
  DEFAULT_RUN_TIMEOUT_MS,
  loadMcpConfig,
  loadMcpTools,
  type Agent,
  type AgentOutcome,
  type ApprovalMode,
  type AgentMode,
  type PerformanceOptions,
} from "@ninjacode/core";
import {
  createProvider,
  isReasoningEffort,
  type ProviderKind,
  type ReasoningEffort,
} from "@ninjacode/providers";
import {
  setAskUserHandler,
  setUserActionHandler,
  CodebaseIndex,
  listGitChangedFiles,
  type SandboxMode,
  type ToolRegistry,
} from "@ninjacode/tools";
import { consumeLastGatewayError, handleAgentEvent, promptApproval } from "./cliEventHandlers.js";
import { gatewayExitCode } from "./gatewayErrorLines.js";
import { setupAskUserHandlers } from "./cliUserHandlers.js";
import { t } from "./i18n.js";
import {
  writeBenchmarkTelemetry,
  writeBenchmarkTelemetryStart,
  type BenchmarkTelemetryConfig,
} from "./benchmarkTelemetry.js";

function providerApiKeyEnv(provider: string | undefined): string | undefined {
  if (!provider) return undefined;
  return process.env[`${provider.toUpperCase().replaceAll("-", "_")}_API_KEY`];
}

function resolveApiKey(flags: Record<string, string | boolean>): string {
  return (
    (flags["api-key"] as string | undefined) ??
    providerApiKeyEnv(flags.provider as string | undefined) ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    process.env.MOONSHOT_API_KEY ??
    process.env.GLM_API_KEY ??
    process.env.MISTRAL_API_KEY ??
    process.env.XAI_API_KEY ??
    process.env.MAMMOUTH_API_KEY ??
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

function parseSandboxMode(flags: Record<string, string | boolean>): SandboxMode {
  const mode = (flags.sandbox as SandboxMode) ?? "workspace-write";
  if (!["read-only", "workspace-write", "danger-full-access"].includes(mode)) {
    console.error(t("cli.invalidSandbox", { mode }));
    process.exit(1);
  }
  return mode;
}

function performanceAblationFromEnv(): {
  performance?: PerformanceOptions;
  enablePromptCache?: boolean;
} {
  const name = process.env.NINJACODE_PERF_ABLATION;
  if (!name || name === "optimized") return {};
  const allEnabled: PerformanceOptions = {
    parallelToolReads: true,
    asyncSessionPersistence: true,
    minimalVolatileContext: true,
  };
  if (name === "control") {
    return {
      performance: {
        parallelToolReads: false,
        asyncSessionPersistence: false,
        minimalVolatileContext: false,
      },
      enablePromptCache: false,
    };
  }
  if (name === "no-parallel-reads") {
    return { performance: { ...allEnabled, parallelToolReads: false } };
  }
  if (name === "no-async-persistence") {
    return { performance: { ...allEnabled, asyncSessionPersistence: false } };
  }
  if (name === "no-provider-cache") return { enablePromptCache: false };
  if (name === "no-context-deltas") {
    return { performance: { ...allEnabled, minimalVolatileContext: false } };
  }
  throw new Error(`Unknown NINJACODE_PERF_ABLATION: ${name}`);
}

export function isWorkspaceTrusted(flags: Readonly<Record<string, string | boolean>>): boolean {
  return flags["trust-workspace"] === true;
}

async function registerWorkspaceMcp(
  tools: ToolRegistry,
  workspace: string,
  sandboxMode: SandboxMode,
): Promise<void> {
  const mcpConfigs = await loadMcpConfig(workspace);
  if (!mcpConfigs.length) return;
  const { tools: mcpTools } = await loadMcpTools(mcpConfigs, {
    workspaceRoot: workspace,
    agentDir: path.join(workspace, ".ninjacode"),
    sandboxMode,
    auth: createOAuthAuthPort(
      createDeviceOAuthHost({
        onUserCode: async ({ userCode, verificationUri }) => {
          console.error(`MCP OAuth: visit ${verificationUri} and enter ${userCode}`);
        },
      }),
      createMemorySecretStore(),
    ),
  });
  for (const tool of mcpTools) tools.register(tool);
}

async function writeTelemetrySafely(
  agent: Agent,
  outcome: AgentOutcome,
  config: BenchmarkTelemetryConfig,
): Promise<boolean> {
  try {
    return await writeBenchmarkTelemetry(agent, outcome, undefined, config);
  } catch (error) {
    console.error(`Benchmark telemetry unavailable: ${(error as Error).message}`);
    return false;
  }
}

function harborTelemetryEnabled(): boolean {
  return Boolean(process.env.NINJACODE_BENCH_TELEMETRY_FILE);
}

export function incompleteRunExitCode(opts: {
  harborTelemetry: boolean;
  wroteFinalTelemetry: boolean;
  gatewayExit?: number;
}): number {
  if (opts.harborTelemetry && opts.wroteFinalTelemetry) return 0;
  return opts.gatewayExit ?? 2;
}

function trajectoryCaptureFromEnv(): { enabled: true; persistPath: string } | undefined {
  const persistPath = process.env.NINJACODE_TRAJECTORY_FILE;
  if (!persistPath) return undefined;
  return { enabled: true, persistPath: path.resolve(persistPath) };
}

function parseReasoningEffort(flags: Record<string, string | boolean>): ReasoningEffort | undefined {
  const effort = flags["reasoning-effort"];
  if (effort === undefined) return undefined;
  if (!isReasoningEffort(effort)) {
    throw new Error(`Invalid --reasoning-effort value: ${String(effort)}`);
  }
  return effort;
}

export async function runTask(flags: Record<string, string | boolean>, task: string): Promise<void> {
  const workspace = path.resolve(String(flags.workspace ?? process.cwd()));
  const kind = (flags.provider as ProviderKind) ?? detectProvider();
  const apiKey = resolveApiKey(flags);
  const workspaceTrusted = isWorkspaceTrusted(flags);
  const reasoningEffort = parseReasoningEffort(flags);
  const runTimeoutMs = Number(flags["run-timeout-ms"]) || DEFAULT_RUN_TIMEOUT_MS;
  const telemetryConfig: BenchmarkTelemetryConfig = {
    provider: kind,
    model: flags.model as string | undefined,
    reasoningEffort,
    runTimeoutMs,
  };
  try {
    await writeBenchmarkTelemetryStart(telemetryConfig);
  } catch (error) {
    console.error(`Benchmark telemetry unavailable: ${(error as Error).message}`);
  }

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
  const sandboxMode = parseSandboxMode(flags);
  const codebaseIndex = new CodebaseIndex(workspace);
  if (!workspaceTrusted) console.error(t("cli.workspaceUntrusted"));
  const runtime = await buildAgentRuntime({
    workspaceRoot: workspace,
    provider,
    approvalMode,
    allowAllTools: !!flags.yes,
    configureTools: workspaceTrusted
      ? async (tools) => registerWorkspaceMcp(tools, workspace, sandboxMode)
      : undefined,
    agent: {
      mode,
      model: flags.model as string | undefined,
      reasoningEffort,
      sandboxMode,
      runTimeoutMs,
      codebaseIndex,
      activeFilesProvider: () => listGitChangedFiles(workspace),
      ...performanceAblationFromEnv(),
      enableCheckpoints: !flags["no-checkpoints"],
      enableWorkspaceHooks: workspaceTrusted,
      trajectory: trajectoryCaptureFromEnv(),
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
  const wroteFinalTelemetry = await writeTelemetrySafely(agent, outcome, telemetryConfig);
  console.log("\n");
  if (!outcome.completed) {
    const gateway = consumeLastGatewayError();
    const exit = gatewayExitCode(gateway);
    if (!gateway) {
      console.error(t("cli.incomplete", { answer: outcome.answer }));
    }
    // Harbor scores from telemetry + verifier. A complete envelope is a
    // scorable trial, not an infrastructure crash, so exit 0.
    process.exitCode = incompleteRunExitCode({
      harborTelemetry: harborTelemetryEnabled(),
      wroteFinalTelemetry,
      gatewayExit: exit,
    });
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
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.MAMMOUTH_API_KEY) return "mammouth";
  return "mock";
}
