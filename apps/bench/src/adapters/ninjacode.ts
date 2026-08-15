import { buildAgentRuntime, type Agent, type AgentOutcome } from "@ninjacode/core";
import { createProvider, MockProvider, type ProviderKind } from "@ninjacode/providers";
import { clearShellSessions } from "@ninjacode/tools";
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
  if (task.editFormat === "patch") {
    Object.defineProperty(provider, "name", { value: "deepseek" });
  }
  return provider;
}

async function createAgent(
  opts: NinjaCodeAdapterOptions,
  task: BenchTask,
  workspaceDir: string,
  signal: AbortSignal,
  runTimeoutMs: number,
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
      model: opts.model,
      runTimeoutMs,
      sandboxMode: "danger-full-access",
      signal,
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

async function settleAgent(agent: Agent, ms = 2_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const state = agent.getState();
    if (state === "idle" || state === "stopped" || state === "failed" || state === "completed") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function runAgentTask(
  opts: NinjaCodeAdapterOptions,
  task: BenchTask,
  workspaceDir: string,
  timeoutMs: number,
): Promise<RunResult> {
  const controller = new AbortController();
  const agent = await createAgent(opts, task, workspaceDir, controller.signal, timeoutMs);
  const timer = setTimeout(() => {
    agent.abort(new DOMException("Bench timeout", "AbortError"));
    controller.abort();
  }, timeoutMs);

  try {
    const outcome = await agent.run(task.prompt);
    if (controller.signal.aborted) {
      await settleAgent(agent);
      return { metrics: {}, outputTail: "", timedOut: true };
    }
    return toRunResult(agent, outcome);
  } catch (err) {
    if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      await settleAgent(agent);
      return { metrics: {}, outputTail: "", timedOut: true };
    }
    return { metrics: {}, outputTail: "", agentError: (err as Error).message };
  } finally {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
    await settleAgent(agent, 500);
    clearShellSessions();
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
