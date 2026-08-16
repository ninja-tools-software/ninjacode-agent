import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveReportPath, thresholdsFromArgs } from "./compareCli.js";

const temporaryDirectories: string[] = [];
const environmentKeys = [
  "BENCH_MIN_PASS_RATE",
  "BENCH_MAX_PASS_RATE_DROP",
  "BENCH_MAX_COST_INCREASE_PCT",
] as const;

afterEach(async () => {
  for (const key of environmentKeys) delete process.env[key];
  await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-compare-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeReport(file: string, startedAt: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      startedAt,
      finishedAt: startedAt,
      agents: ["ninjacode"],
      results: [],
    }),
  );
}

describe("compare CLI", () => {
  it("selects the newest valid report recursively from an artifact directory", async () => {
    const directory = await temporaryDirectory();
    await fs.writeFile(path.join(directory, "metadata.json"), '{"not":"a report"}');
    await writeReport(path.join(directory, "old.json"), "2026-01-01T00:00:00Z");
    const newest = path.join(directory, "nested", "new.json");
    await writeReport(newest, "2026-01-02T00:00:00Z");
    expect(await resolveReportPath(directory)).toBe(newest);
  });

  it("loads configurable thresholds from flags and environment", () => {
    process.env.BENCH_MIN_PASS_RATE = "0.8";
    process.env.BENCH_MAX_COST_INCREASE_PCT = "20";
    expect(
      thresholdsFromArgs(["--max-pass-rate-drop", "0.05", "--allow-incompatible"]),
    ).toMatchObject({
      minPassRate: 0.8,
      maxPassRateDrop: 0.05,
      maxCostIncreasePercent: 20,
      requireComparable: false,
    });
  });

  it("rejects invalid rate thresholds", () => {
    expect(() => thresholdsFromArgs(["--min-pass-rate", "80"])).toThrow(
      "Invalid --min-pass-rate",
    );
  });
});
