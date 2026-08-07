import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../types.js";
import {
  DEFAULT_MODEL_SORT,
  formatModelSort,
  parseModelSort,
  sortModels,
  toggleSort,
} from "./modelSort.js";

function model(partial: Partial<ModelInfo> & { id: string }): ModelInfo {
  return {
    label: partial.id,
    contextWindow: 128_000,
    maxOutput: 8_000,
    ...partial,
  };
}

describe("parseModelSort", () => {
  it("round-trips a valid sort id", () => {
    expect(parseModelSort("perf-asc")).toBe("perf-asc");
    expect(formatModelSort({ column: "perf", direction: "asc" })).toBe("perf-asc");
  });

  it("falls back to the default for invalid or missing values", () => {
    expect(parseModelSort(undefined)).toBe(DEFAULT_MODEL_SORT);
    expect(parseModelSort("bogus")).toBe(DEFAULT_MODEL_SORT);
  });
});

describe("toggleSort", () => {
  it("flips direction when clicking the active column", () => {
    expect(toggleSort("cost-desc", "cost")).toBe("cost-asc");
    expect(toggleSort("cost-asc", "cost")).toBe("cost-desc");
  });

  it("switches to the other column defaulting to descending", () => {
    expect(toggleSort("cost-asc", "perf")).toBe("perf-desc");
    expect(toggleSort("perf-asc", "cost")).toBe("cost-desc");
  });
});

describe("sortModels", () => {
  const auto = model({ id: "auto", tags: ["auto"], costIndex: null });
  const cheap = model({ id: "cheap", costIndex: 1 });
  const pricey = model({ id: "pricey", costIndex: 50 });
  const unknownCost = model({ id: "unknown-cost", costIndex: null });
  const goodPerf = model({ id: "good-perf", benchmark: { intelligenceIndex: 80, codingIndex: 80, agenticIndex: 80, strengths: [], weaknesses: [] } });
  const weakPerf = model({ id: "weak-perf", benchmark: { intelligenceIndex: 20, codingIndex: 20, agenticIndex: 20, strengths: [], weaknesses: [] } });
  const noPerf = model({ id: "no-perf" });

  it("pins auto first regardless of the column sorted on", () => {
    const sorted = sortModels([cheap, auto, pricey], "cost-desc");
    expect(sorted.map((m) => m.id)).toEqual(["auto", "pricey", "cheap"]);
  });

  it("sorts by cost ascending/descending, nulls always last", () => {
    expect(sortModels([pricey, cheap, unknownCost], "cost-desc").map((m) => m.id)).toEqual([
      "pricey",
      "cheap",
      "unknown-cost",
    ]);
    expect(sortModels([pricey, cheap, unknownCost], "cost-asc").map((m) => m.id)).toEqual([
      "cheap",
      "pricey",
      "unknown-cost",
    ]);
  });

  it("sorts by performance ascending/descending, nulls always last", () => {
    expect(sortModels([weakPerf, goodPerf, noPerf], "perf-desc").map((m) => m.id)).toEqual([
      "good-perf",
      "weak-perf",
      "no-perf",
    ]);
    expect(sortModels([weakPerf, goodPerf, noPerf], "perf-asc").map((m) => m.id)).toEqual([
      "weak-perf",
      "good-perf",
      "no-perf",
    ]);
  });
});
