import fs from "node:fs/promises";
import path from "node:path";
import {
  compareReports,
  compareToMarkdown,
  evaluateCompareGates,
  type CompareThresholds,
} from "./compare.js";
import type { RunReport } from "./types.js";

const VALUE_FLAGS = new Set([
  "--baseline",
  "--current",
  "--output",
  "--min-pass-rate",
  "--max-pass-rate-drop",
  "--max-cost-increase-pct",
  "--max-wall-time-increase-pct",
  "--max-tool-errors-increase",
]);

function getFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionalArgs(args: string[]): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (VALUE_FLAGS.has(argument)) {
      index++;
    } else if (!argument.startsWith("--")) {
      positional.push(argument);
    }
  }
  return positional;
}

async function reportCandidates(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return reportCandidates(candidate);
      return entry.isFile() && entry.name.endsWith(".json") ? [candidate] : [];
    }),
  );
  return nested.flat();
}

async function readReport(file: string): Promise<RunReport | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<RunReport>;
    return typeof parsed.startedAt === "string" && Array.isArray(parsed.results)
      ? (parsed as RunReport)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveReportPath(input: string): Promise<string> {
  const stat = await fs.stat(input);
  if (stat.isFile()) return input;
  if (!stat.isDirectory()) throw new Error(`Not a report file or directory: ${input}`);
  const candidates = await reportCandidates(input);
  const reports = (
    await Promise.all(
      candidates.map(async (file) => {
        const report = await readReport(file);
        return report ? { file, startedAt: report.startedAt } : undefined;
      }),
    )
  ).filter((item): item is { file: string; startedAt: string } => Boolean(item));
  reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.file.localeCompare(a.file));
  if (!reports[0]) throw new Error(`No NinjaBench run report found under: ${input}`);
  return reports[0].file;
}

function parseNumber(
  raw: string | undefined,
  name: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)
  ) {
    throw new Error(`Invalid --${name} value: ${raw}`);
  }
  return value;
}

function flagOrEnv(args: string[], flag: string, environment: string): string | undefined {
  return getFlag(args, flag) ?? process.env[environment];
}

export function thresholdsFromArgs(args: string[]): CompareThresholds {
  return {
    minPassRate: parseNumber(
      flagOrEnv(args, "min-pass-rate", "BENCH_MIN_PASS_RATE"),
      "min-pass-rate",
      { min: 0, max: 1 },
    ),
    maxPassRateDrop: parseNumber(
      flagOrEnv(args, "max-pass-rate-drop", "BENCH_MAX_PASS_RATE_DROP"),
      "max-pass-rate-drop",
      { min: 0, max: 1 },
    ),
    maxCostIncreasePercent: parseNumber(
      flagOrEnv(args, "max-cost-increase-pct", "BENCH_MAX_COST_INCREASE_PCT"),
      "max-cost-increase-pct",
      { min: 0 },
    ),
    maxWallTimeIncreasePercent: parseNumber(
      flagOrEnv(args, "max-wall-time-increase-pct", "BENCH_MAX_WALL_TIME_INCREASE_PCT"),
      "max-wall-time-increase-pct",
      { min: 0 },
    ),
    maxToolErrorsIncrease: parseNumber(
      flagOrEnv(args, "max-tool-errors-increase", "BENCH_MAX_TOOL_ERRORS_INCREASE"),
      "max-tool-errors-increase",
      { min: 0 },
    ),
    requireComparable: !args.includes("--allow-incompatible"),
  };
}

export async function cmdCompare(args: string[]): Promise<void> {
  const positional = positionalArgs(args);
  const baselineInput = getFlag(args, "baseline") ?? positional[0];
  const currentInput = getFlag(args, "current") ?? positional[1];
  if (!baselineInput || !currentInput) {
    throw new Error(
      "Usage: ninjabench compare <baseline.json|dir> <current.json|dir> [gate options]",
    );
  }
  const [baselinePath, currentPath] = await Promise.all([
    resolveReportPath(baselineInput),
    resolveReportPath(currentInput),
  ]);
  const [baseline, current] = await Promise.all([
    readReport(baselinePath),
    readReport(currentPath),
  ]);
  if (!baseline || !current) throw new Error("Selected input is not a NinjaBench run report");

  const markdown = compareToMarkdown(baseline, current);
  const gate = evaluateCompareGates(compareReports(baseline, current), thresholdsFromArgs(args));
  const gateMarkdown = gate.passed
    ? "\n## CI gates\n\nPASS\n"
    : `\n## CI gates\n\nFAIL\n\n${gate.failures.map((failure) => `- ${failure}`).join("\n")}\n`;
  const output = `${markdown}${gateMarkdown}`;
  console.log(output);
  const outputPath = getFlag(args, "output");
  if (outputPath) {
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(outputPath, output);
  }
  if (!gate.passed) process.exitCode = 1;
}
