import { buildAgentRuntime, type Agent, type AgentOutcome } from "@ninjacode/core";
import { createProvider, MockProvider, type ProviderKind } from "@ninjacode/providers";
import type { AgentAdapter, BenchTask, TaskMetrics } from "../types.js";

interface NinjaCodeAdapterOptions {
  provider: ProviderKind | "mock";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTurns?: number;
  name?: string;
  /** SWE-bench needs network for installs/tests; internal bench tasks stay offline. */
  includeNetwork?: boolean;
}

interface RunResult {
  metrics: Partial<TaskMetrics>;
  outputTail: string;
  timedOut?: boolean;
  agentError?: string;
}

function histogram(names: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

function buildProvider(opts: NinjaCodeAdapterOptions, task: BenchTask): MockProvider | ReturnType<typeof createProvider> {
  if (opts.provider !== "mock") {
    return createProvider({
      kind: opts.provider,
      apiKey: opts.apiKey ?? "",
      model: opts.model,
      baseUrl: opts.baseUrl,
    });
  }
  const scripts = task.scripts?.length ? task.scripts : [{ text: "mock run (no-op)" }];
  const provider = new MockProvider(scripts);
  // preferredEditFormat keys off provider.name; mock defaults to string_replace
  // which strips apply_patch. Patch-format harness tasks need a patch-preferring name.
  if (task.editFormat === "patch") {
    Object.defineProperty(provider, "name", { value: "deepseek" });
  }
  return provider;
}

async function createAgent(
  opts: NinjaCodeAdapterOptions,
  task: BenchTask,
  workspaceDir: string,
): Promise<Agent> {
  const provider = buildProvider(opts, task);
  const runtime = await buildAgentRuntime({
    workspaceRoot: workspaceDir,
    provider,
    approvalMode: "autonomous",
    allowAllTools: true,
    includeNetwork: opts.includeNetwork ?? false,
    agent: {
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
      maxTurns: task.maxTurns ?? opts.maxTurns ?? 40,
      // Drives the cost estimate: without it every run is billed at Anthropic rates.
      model: opts.model,
    },
  });
  return runtime.createAgent();
}

function toRunResult(agent: Agent, outcome: AgentOutcome): RunResult {
  const stats = agent.getCacheStats();
  const toolInvocations = outcome.turns.flatMap((t) => t.toolInvocations);
  return {
    metrics: {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheReadTokens: stats.cacheReadTokens,
      cacheWriteTokens: stats.cacheWriteTokens,
      estimatedCostUsd: stats.estimatedCostUsd,
      turns: outcome.turns.length,
      toolCalls: toolInvocations.length,
      toolErrors: toolInvocations.filter((t) => t.error).length,
      toolHistogram: histogram(toolInvocations.map((t) => t.toolCall.name)),
    },
    outputTail: outcome.answer.slice(-8000),
    agentError: outcome.completed ? undefined : outcome.answer || "agent did not complete",
  };
}

async function runAgentTask(
  opts: NinjaCodeAdapterOptions,
  task: BenchTask,
  workspaceDir: string,
  timeoutMs: number,
): Promise<RunResult> {
  const agent = await createAgent(opts, task, workspaceDir);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const raced = await Promise.race([agent.run(task.prompt), timeout]);
    if (raced === "timeout") return { metrics: {}, outputTail: "", timedOut: true };
    return toRunResult(agent, raced);
  } catch (err) {
    return { metrics: {}, outputTail: "", agentError: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the NinjaCode agent in-process — gives us full token/turn/tool telemetry. */
export function createNinjaCodeAdapter(opts: NinjaCodeAdapterOptions): AgentAdapter {
  const name = opts.name ?? `ninjacode/${opts.provider}${opts.model ? `/${opts.model}` : ""}`;
  return {
    name,
    run: (task, workspaceDir, timeoutMs) => runAgentTask(opts, task, workspaceDir, timeoutMs),
  };
}
