import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveModelPricing, type ModelPricing, type ProviderKind } from "@ninjacode/providers";
import { createNinjaCodeAdapter } from "../adapters/ninjacode.js";
import { createCliAdapter, type CliAdapterConfig } from "../adapters/cli.js";
import type { AgentAdapter, BenchTask } from "../types.js";
import { estimateCostUsd } from "./cost.js";
import { loadSweBenchLite, SWE_BENCH_LITE } from "./dataset.js";
import { serializePredictionLine } from "./jsonl.js";
import { buildSweBenchPrompt } from "./prompt.js";
import { summarizePredictTelemetry } from "./telemetry.js";
import type { PredictInstanceRecord, PredictRunMeta, SweBenchInstance } from "./types.js";
import { cleanupSweBenchWorkspace, extractModelPatch, prepareSweBenchWorkspace } from "./workspace.js";

const execFileAsync = promisify(execFile);

interface PredictOptions {
  provider: ProviderKind | "mock";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  agentsFile?: string;
  noNinjacode?: boolean;
  instanceIds?: string[];
  limit?: number;
  timeoutSec: number;
  maxTurns: number;
  out: string;
  cacheDir?: string;
  keepFailures?: boolean;
  onProgress?: (line: string) => void;
}

function toBenchTask(instance: SweBenchInstance, timeoutSec: number): BenchTask {
  return {
    id: instance.instance_id,
    description: instance.instance_id,
    category: "fix",
    difficulty: "hard",
    prompt: buildSweBenchPrompt(instance),
    verify: "true",
    timeoutSec,
  };
}

async function buildPredictAgents(opts: PredictOptions): Promise<AgentAdapter[]> {
  const agents: AgentAdapter[] = [];
  if (!opts.noNinjacode) {
    agents.push(
      createNinjaCodeAdapter({
        provider: opts.provider,
        model: opts.model,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        maxTurns: opts.maxTurns,
        includeNetwork: true,
      }),
    );
  }
  if (opts.agentsFile) {
    const raw = await fs.readFile(opts.agentsFile, "utf8");
    const configs = JSON.parse(raw) as CliAdapterConfig[];
    for (const config of configs) agents.push(createCliAdapter(config));
  }
  if (agents.length === 0) {
    throw new Error("No agents configured. Omit --no-ninjacode or pass --agents.");
  }
  return agents;
}

function sanitizeFileName(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9._-]+/g, "-");
}

async function gitCommitShort(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function formatInstanceLog(record: PredictInstanceRecord): string {
  const cost = record.estimatedCostUsd !== undefined ? `  ~$${record.estimatedCostUsd.toFixed(4)}` : "";
  const cached = record.cacheReadTokens ? `  cacheRead=${record.cacheReadTokens}` : "";
  const turns = record.turns !== undefined ? `  turns=${record.turns}` : "";
  return (
    `${record.status.padEnd(12)} ${record.instanceId}  ` +
    `${(record.wallTimeMs / 1000).toFixed(1)}s${turns}${cached}${cost}` +
    (record.emptyPatch ? "  [empty patch]" : "")
  );
}

/** Run one instance in a throwaway workspace; never throws, records the failure instead. */
async function runOneInstance(
  agent: AgentAdapter,
  instance: SweBenchInstance,
  opts: PredictOptions,
  pricing: ModelPricing,
): Promise<{ record: PredictInstanceRecord; patch: string }> {
  const task = toBenchTask(instance, opts.timeoutSec);
  const start = Date.now();
  let workspaceDir: string | undefined;

  try {
    workspaceDir = await prepareSweBenchWorkspace(instance);
    const result = await agent.run(task, workspaceDir, opts.timeoutSec * 1000);
    const patch = await extractModelPatch(workspaceDir);
    const record: PredictInstanceRecord = {
      instanceId: instance.instance_id,
      status: result.timedOut ? "timeout" : result.agentError ? "agent_error" : "ok",
      emptyPatch: !patch.trim(),
      wallTimeMs: Date.now() - start,
      inputTokens: result.metrics.inputTokens,
      outputTokens: result.metrics.outputTokens,
      cacheReadTokens: result.metrics.cacheReadTokens,
      cacheWriteTokens: result.metrics.cacheWriteTokens,
      turns: result.metrics.turns,
      toolCalls: result.metrics.toolCalls,
      toolErrors: result.metrics.toolErrors,
      toolHistogram: result.metrics.toolHistogram,
      errorMessage: result.agentError,
    };
    return {
      patch,
      record:
        record.inputTokens === undefined
          ? record
          : { ...record, estimatedCostUsd: estimateCostUsd(record, pricing) },
    };
  } catch (err) {
    return {
      patch: "",
      record: {
        instanceId: instance.instance_id,
        status: "agent_error",
        emptyPatch: true,
        wallTimeMs: Date.now() - start,
        errorMessage: (err as Error).message,
      },
    };
  } finally {
    if (workspaceDir && !opts.keepFailures) await cleanupSweBenchWorkspace(workspaceDir);
  }
}

function buildRunMeta(
  agentName: string,
  records: PredictInstanceRecord[],
  ctx: { startedAt: string; gitCommit?: string; predictionsPath: string },
): PredictRunMeta {
  const costs = records.filter((r) => r.estimatedCostUsd !== undefined);
  return {
    agentName,
    modelNameOrPath: agentName,
    startedAt: ctx.startedAt,
    finishedAt: new Date().toISOString(),
    gitCommit: ctx.gitCommit,
    dataset: SWE_BENCH_LITE,
    instanceIds: records.map((r) => r.instanceId),
    totalInstances: records.length,
    succeeded: records.filter((r) => r.status === "ok").length,
    timedOut: records.filter((r) => r.status === "timeout").length,
    agentErrors: records.filter((r) => r.status === "agent_error").length,
    emptyPatches: records.filter((r) => r.emptyPatch).length,
    totalWallTimeMs: records.reduce((acc, r) => acc + r.wallTimeMs, 0),
    totalCostUsd: costs.length
      ? costs.reduce((acc, r) => acc + (r.estimatedCostUsd ?? 0), 0)
      : undefined,
    predictionsPath: ctx.predictionsPath,
    instances: records,
    telemetry: summarizePredictTelemetry(records),
  };
}

async function predictForAgent(
  agent: AgentAdapter,
  instances: SweBenchInstance[],
  opts: PredictOptions,
): Promise<PredictRunMeta> {
  const log = opts.onProgress ?? (() => undefined);
  const pricing = resolveModelPricing(opts.model);
  const ctx = {
    startedAt: new Date().toISOString(),
    gitCommit: await gitCommitShort(),
    predictionsPath: path.join(opts.out, `${sanitizeFileName(agent.name)}.jsonl`),
  };
  await fs.writeFile(ctx.predictionsPath, "");

  const records: PredictInstanceRecord[] = [];
  for (const instance of instances) {
    const { record, patch } = await runOneInstance(agent, instance, opts, pricing);
    records.push(record);
    await fs.appendFile(
      ctx.predictionsPath,
      serializePredictionLine({
        instance_id: instance.instance_id,
        model_name_or_path: agent.name,
        model_patch: patch,
      }),
    );
    // Flushed every instance so an interrupted run still yields usable metrics.
    const meta = buildRunMeta(agent.name, records, ctx);
    await fs.writeFile(predictMetaPath(ctx.predictionsPath), JSON.stringify(meta, null, 2));
    log(formatInstanceLog(record));
  }

  return buildRunMeta(agent.name, records, ctx);
}

/** Path of the durable run artifact a later run can be diffed against. */
export function predictMetaPath(predictionsPath: string): string {
  return predictionsPath.replace(/\.jsonl$/, ".predict.json");
}

export async function runSweBenchPredict(opts: PredictOptions): Promise<PredictRunMeta[]> {
  const instances = await loadSweBenchLite({
    cacheDir: opts.cacheDir,
    instanceIds: opts.instanceIds,
    limit: opts.limit,
  });
  if (instances.length === 0) throw new Error("No SWE-bench Lite instances matched the filter.");

  const agents = await buildPredictAgents(opts);
  await fs.mkdir(opts.out, { recursive: true });

  const metas: PredictRunMeta[] = [];
  for (const agent of agents) {
    metas.push(await predictForAgent(agent, instances, opts));
  }
  return metas;
}
