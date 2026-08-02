import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveModelPricing,
  type ModelPricing,
  type ProviderKind,
} from "@ninjacode/providers";
import { getFlag, getFlagInt, getFlagList, hasFlag } from "./args.js";
import { repricePredictMeta } from "./cost.js";
import { runSweBenchEval } from "./eval.js";
import { predictMetaPath, runSweBenchPredict } from "./predict.js";
import {
  compareEvalRuns,
  evalMetaToMarkdown,
  predictDeltaToMarkdown,
  predictMetaToMarkdown,
  toCompareMarkdown,
} from "./report.js";
import { subsetPredictMeta } from "./telemetry.js";
import type { EvalRunMeta, PredictRunMeta } from "./types.js";

function defaultProvider(args: string[]): ProviderKind | "mock" {
  return (getFlag(args, "provider") ??
    process.env.NINJABENCH_PROVIDER ??
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock")) as ProviderKind | "mock";
}

/**
 * A missing key does not fail loudly downstream — it produces a full run of
 * zero-turn instances — so resolve the provider's own conventional variable and
 * refuse to start without one.
 */
function resolveApiKey(args: string[], provider: ProviderKind | "mock"): string | undefined {
  if (provider === "mock") return undefined;
  const key =
    getFlag(args, "api-key") ??
    process.env.NINJABENCH_API_KEY ??
    process.env[`${provider.toUpperCase()}_API_KEY`];
  if (!key?.trim()) {
    throw new Error(
      `No API key for provider "${provider}": set ${provider.toUpperCase()}_API_KEY, ` +
        "NINJABENCH_API_KEY, or pass --api-key.",
    );
  }
  return key;
}

async function loadPredictMeta(filePath: string): Promise<PredictRunMeta> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as PredictRunMeta;
}

/** Delta section appended to the run report when `--baseline` points at a prior run. */
async function buildBaselineDelta(
  baselinePath: string | undefined,
  metas: PredictRunMeta[],
  pricing: ModelPricing,
): Promise<string> {
  if (!baselinePath) return "";
  const baseline = await loadPredictMeta(baselinePath);
  const current = metas.find((m) => m.agentName === baseline.agentName) ?? metas[0];
  if (!current) return "";
  // Compare like for like: same instances, same price table on both sides.
  const comparable = repricePredictMeta(subsetPredictMeta(baseline, current.instanceIds), pricing);
  return `\n${predictDeltaToMarkdown(comparable, current)}`;
}

export async function cmdSweBenchPredict(args: string[]): Promise<void> {
  const out = getFlag(args, "out") ?? path.join(process.cwd(), "runs", "swebench");
  const model = getFlag(args, "model") ?? process.env.NINJABENCH_MODEL;
  const provider = defaultProvider(args);
  const metas = await runSweBenchPredict({
    provider,
    model,
    apiKey: resolveApiKey(args, provider),
    baseUrl: getFlag(args, "base-url"),
    agentsFile: getFlag(args, "agents"),
    noNinjacode: hasFlag(args, "no-ninjacode"),
    instanceIds: getFlagList(args, "instance-ids"),
    limit: getFlag(args, "limit") ? getFlagInt(args, "limit", 0) : undefined,
    timeoutSec: getFlagInt(args, "timeout-sec", 1800),
    maxTurns: getFlagInt(args, "max-turns", 80),
    out,
    cacheDir: getFlag(args, "cache-dir"),
    keepFailures: hasFlag(args, "keep-failures"),
    onProgress: (line) => console.log(line),
  });

  const delta = await buildBaselineDelta(getFlag(args, "baseline"), metas, resolveModelPricing(model));
  const mdPath = path.join(out, `predict-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.md`);
  await fs.writeFile(mdPath, predictMetaToMarkdown(metas) + delta);
  console.log(`\nPredictions written under ${out}`);
  for (const meta of metas) {
    console.log(`  ${meta.agentName}: ${meta.predictionsPath}`);
    console.log(`  ${meta.agentName}: ${predictMetaPath(meta.predictionsPath)} (run metrics)`);
  }
  if (delta) console.log(delta);
  console.log(`Report: ${mdPath}`);
}

export async function cmdSweBenchEval(args: string[]): Promise<void> {
  const predictionsPath = getFlag(args, "predictions");
  if (!predictionsPath) {
    console.error("Missing --predictions <path-to.jsonl>");
    process.exitCode = 1;
    return;
  }
  const runId = getFlag(args, "run-id") ?? path.basename(predictionsPath, ".jsonl");
  const outDir = getFlag(args, "out") ?? path.join(process.cwd(), "runs", "swebench", "eval", runId);

  const meta = await runSweBenchEval({
    predictionsPath,
    runId,
    dataset: getFlag(args, "dataset"),
    maxWorkers: getFlagInt(args, "max-workers", 4),
    python: getFlag(args, "python"),
    instanceIds: getFlagList(args, "instance-ids"),
    outDir,
    onProgress: (line) => console.log(line),
  });

  const mdPath = path.join(outDir, `${runId}.md`);
  await fs.writeFile(mdPath, evalMetaToMarkdown(meta));
  console.log(`\nResolved ${meta.resolvedCount}/${meta.total} (${(meta.passRate * 100).toFixed(1)}%)`);
  console.log(`Report: ${meta.reportPath}`);
  console.log(`Summary: ${mdPath}`);
}

async function loadEvalMeta(filePath: string): Promise<EvalRunMeta> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as EvalRunMeta;
}

export async function cmdSweBenchCompare(args: string[]): Promise<void> {
  const evalPaths = getFlagList(args, "evals");
  const evalDir = getFlag(args, "eval-dir");
  const files = evalPaths ?? [];

  if (evalDir) {
    const entries = await fs.readdir(evalDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".eval.json")) {
        files.push(path.join(evalDir, entry.name));
      }
    }
  }

  if (files.length === 0) {
    console.error("Pass --evals file1.json,file2.json or --eval-dir <directory>");
    process.exitCode = 1;
    return;
  }

  const evals: EvalRunMeta[] = [];
  for (const file of files) {
    evals.push(await loadEvalMeta(file));
  }

  const rows = compareEvalRuns(evals);
  const markdown = toCompareMarkdown(rows, evals);
  const out = getFlag(args, "out") ?? path.join(process.cwd(), "runs", "swebench", "compare.md");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, markdown);
  console.log(markdown);
  console.log(`\nSaved: ${out}`);
}

export function printSweBenchHelp(): void {
  console.log(
    [
      "SWE-bench Lite integration (predict → Docker eval → compare)",
      "",
      "  ninjabench swebench predict [options]",
      "  ninjabench swebench eval [options]",
      "  ninjabench swebench compare [options]",
      "",
      "Predict options:",
      "  --out DIR              Output directory (default ./runs/swebench)",
      "  --instance-ids a,b       Subset of instance ids",
      "  --limit N              First N instances from Lite",
      "  --timeout-sec N        Per-instance agent timeout (default 1800)",
      "  --max-turns N          NinjaCode max turns (default 80)",
      "  --provider KIND        anthropic|openai|…|mock",
      "  --model NAME           Model override",
      "  --api-key KEY          API key (defaults to env)",
      "  --agents FILE          Competitor CLIs JSON config",
      "  --no-ninjacode         Skip in-process NinjaCode agent",
      "  --keep-failures        Keep temp workspaces on failure",
      "  --baseline FILE        Prior *.predict.json to diff tokens/cache/turns against",
      "",
      "Eval options:",
      "  --predictions FILE     Predictions JSONL (required)",
      "  --run-id ID            Evaluation run id (default: predictions basename)",
      "  --out DIR              Eval logs/output directory",
      "  --max-workers N        Docker workers (default 4)",
      "  --python PATH          Python executable (default python3)",
      "  --instance-ids a,b     Evaluate subset only",
      "",
      "Compare options:",
      "  --evals f1.json,f2     Eval report JSON files",
      "  --eval-dir DIR         Directory of eval report JSON files",
      "  --out FILE             Comparison markdown path",
    ].join("\n"),
  );
}
