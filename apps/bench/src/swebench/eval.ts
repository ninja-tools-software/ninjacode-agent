import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { SWE_BENCH_LITE } from "./dataset.js";
import type { EvalRunMeta } from "./types.js";

interface EvalOptions {
  predictionsPath: string;
  runId: string;
  dataset?: string;
  maxWorkers: number;
  python?: string;
  instanceIds?: string[];
  outDir: string;
  onProgress?: (line: string) => void;
}

interface ParsedEvalSummary {
  resolved: string[];
  unresolved: string[];
  errors: string[];
}

const INSTANCE_ID = String.raw`([a-zA-Z0-9_.-]+__[\w.-]+-\d+)`;

/**
 * Report schema v2 of `swebench.harness.run_evaluation`: id lists per outcome.
 * An instance the harness could not run at all (`error_ids`, `incomplete_ids`)
 * is not an unresolved instance — counting it as one would flatter the harness
 * by shrinking the denominator's honesty, so it gets its own bucket.
 */
function parseReport(reportContent: string): ParsedEvalSummary | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(reportContent) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const resolved = new Set<string>();
  const unresolved = new Set<string>();
  const errors = new Set<string>();
  mergeIdList(resolved, parsed.resolved_ids);
  mergeIdList(unresolved, parsed.unresolved_ids);
  mergeIdList(unresolved, parsed.empty_patch_ids);
  mergeIdList(errors, parsed.error_ids);
  mergeIdList(errors, parsed.incomplete_ids);

  if (resolved.size + unresolved.size + errors.size === 0) return undefined;
  return finalizeSummary(resolved, unresolved, errors);
}

/** Parses SWE-bench harness stdout / report files for resolved instance ids. */
export function parseEvalSummary(stdout: string, reportContent?: string): ParsedEvalSummary {
  const fromReport = reportContent ? parseReport(reportContent) : undefined;
  if (fromReport) return fromReport;

  const resolved = new Set<string>();
  const unresolved = new Set<string>();
  for (const match of stdout.matchAll(new RegExp(`resolved[^\\n]*\\b${INSTANCE_ID}\\b`, "g"))) {
    resolved.add(match[1]!);
  }
  for (const match of stdout.matchAll(new RegExp(`unresolved[^\\n]*\\b${INSTANCE_ID}\\b`, "g"))) {
    unresolved.add(match[1]!);
  }
  return finalizeSummary(resolved, unresolved, new Set());
}

function finalizeSummary(
  resolved: Set<string>,
  unresolved: Set<string>,
  errors: Set<string>,
): ParsedEvalSummary {
  return {
    resolved: [...resolved],
    unresolved: [...unresolved].filter((id) => !resolved.has(id)),
    errors: [...errors].filter((id) => !resolved.has(id) && !unresolved.has(id)),
  };
}

function mergeIdList(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry === "string") target.add(entry);
  }
}

/**
 * The harness writes `<model_name_or_path>.<run_id>.json` into its cwd, so the
 * file is found by suffix rather than by a name we could predict.
 */
async function findReportFile(runId: string, cwd: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(cwd);
    const match = entries.find((name) => name.endsWith(`.${runId}.json`));
    if (match) return path.join(cwd, match);
  } catch {
    return undefined;
  }
  return undefined;
}

function harnessArgs(opts: EvalOptions, dataset: string): string[] {
  const args = [
    "-m",
    "swebench.harness.run_evaluation",
    "--dataset_name",
    dataset,
    // The harness runs with `outDir` as its cwd, so a relative path would not resolve.
    "--predictions_path",
    path.resolve(opts.predictionsPath),
    "--run_id",
    opts.runId,
    "--max_workers",
    String(opts.maxWorkers),
  ];
  if (opts.instanceIds?.length) args.push("--instance_ids", ...opts.instanceIds);
  return args;
}

/** Runs the official Docker harness, streaming its output to `log`. */
function runHarness(
  python: string,
  args: string[],
  cwd: string,
  log: (line: string) => void,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(python, args, { cwd, env: process.env });
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split("\n")) if (line.trim()) log(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`swebench.harness.run_evaluation exited ${code}\n${stderr || stdout}`));
    });
  });
}

async function readReport(runId: string, outDir: string): Promise<string | undefined> {
  const reportPath = await findReportFile(runId, outDir);
  if (!reportPath) return undefined;
  try {
    return await fs.readFile(reportPath, "utf8");
  } catch {
    return undefined;
  }
}

export async function runSweBenchEval(opts: EvalOptions): Promise<EvalRunMeta> {
  const log = opts.onProgress ?? (() => undefined);
  const dataset = opts.dataset ?? SWE_BENCH_LITE;
  const python = opts.python ?? process.env.SWEBENCH_PYTHON ?? "python3";
  const startedAt = new Date().toISOString();
  await fs.mkdir(opts.outDir, { recursive: true });

  const { stdout, stderr } = await runHarness(python, harnessArgs(opts, dataset), opts.outDir, log);
  const summary = parseEvalSummary(`${stdout}\n${stderr}`, await readReport(opts.runId, opts.outDir));
  const totalFromLists = summary.resolved.length + summary.unresolved.length + summary.errors.length;
  const resolvedCount = summary.resolved.length;
  const reportPath = path.join(opts.outDir, `${opts.runId}.eval.json`);
  const meta: EvalRunMeta = {
    runId: opts.runId,
    predictionsPath: opts.predictionsPath,
    dataset,
    startedAt,
    finishedAt: new Date().toISOString(),
    resolved: summary.resolved,
    unresolved: summary.unresolved,
    errors: summary.errors,
    total: totalFromLists,
    resolvedCount,
    passRate: totalFromLists > 0 ? resolvedCount / totalFromLists : 0,
    logsDir: opts.outDir,
    reportPath,
  };

  await fs.writeFile(reportPath, JSON.stringify(meta, null, 2));
  return meta;
}
