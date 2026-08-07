import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../types.js";
import {
  arenaBarWidth,
  arenaCategoryLabel,
  formatPerformanceScore,
  formatWinRate,
  gaugeBarWidth,
  hasArenaScores,
  hasBenchmarkData,
  hasIndices,
  hasLlmStats,
  performanceScore,
  performanceScoreColor,
  regionLabel,
  scoreTone,
} from "./modelBenchmark.js";

const base: ModelInfo = {
  id: "m",
  label: "M",
  contextWindow: 100_000,
  maxOutput: 8_192,
};

describe("hasBenchmarkData", () => {
  it("is false when all datasets are empty", () => {
    expect(hasBenchmarkData(base)).toBe(false);
    expect(
      hasBenchmarkData({ ...base, benchmark: null, llmStats: null, arenaScores: [] }),
    ).toBe(false);
  });

  it("is true when indices exist", () => {
    expect(
      hasBenchmarkData({
        ...base,
        benchmark: {
          intelligenceIndex: 1,
          codingIndex: null,
          agenticIndex: null,
          strengths: [],
          weaknesses: [],
        },
      }),
    ).toBe(true);
    expect(hasIndices({ ...base, benchmark: null })).toBe(false);
  });

  it("is true when llmStats exist", () => {
    expect(
      hasLlmStats({
        ...base,
        llmStats: {
          score: 50,
          reasoningIndex: null,
          codingIndex: null,
          agentIndex: null,
        },
      }),
    ).toBe(true);
    expect(hasLlmStats({ ...base, llmStats: null })).toBe(false);
    expect(
      hasBenchmarkData({
        ...base,
        llmStats: {
          score: 50,
          reasoningIndex: null,
          codingIndex: null,
          agentIndex: null,
        },
      }),
    ).toBe(true);
  });

  it("is true when arena scores exist", () => {
    expect(
      hasArenaScores({
        ...base,
        arenaScores: [{ arena: "Design Arena", category: "codecategories", elo: 1, winRate: null }],
      }),
    ).toBe(true);
    expect(hasArenaScores({ ...base, arenaScores: [] })).toBe(false);
  });
});

describe("scoreTone", () => {
  it("bands low / mid / high scores on a 0–100 scale", () => {
    expect(scoreTone(10)).toBe("danger");
    expect(scoreTone(39.9)).toBe("danger");
    expect(scoreTone(40)).toBe("warn");
    expect(scoreTone(69.9)).toBe("warn");
    expect(scoreTone(70)).toBe("accent");
    expect(scoreTone(100)).toBe("accent");
  });

  it("scales bands proportionally when max is not 100", () => {
    expect(scoreTone(20, 60)).toBe("danger");
    expect(scoreTone(24, 60)).toBe("warn");
    expect(scoreTone(42, 60)).toBe("accent");
  });
});

describe("gaugeBarWidth", () => {
  it("scales value against max", () => {
    expect(gaugeBarWidth(30, 60)).toBe(50);
    expect(gaugeBarWidth(60, 60)).toBe(100);
    expect(gaugeBarWidth(0, 60)).toBe(0);
    expect(gaugeBarWidth(10, 0)).toBe(0);
  });
});

describe("arenaBarWidth", () => {
  it("scales elo against the max", () => {
    expect(arenaBarWidth(500, 1000)).toBe(50);
    expect(arenaBarWidth(1000, 1000)).toBe(100);
    expect(arenaBarWidth(0, 1000)).toBe(0);
    expect(arenaBarWidth(10, 0)).toBe(0);
  });
});

describe("formatWinRate", () => {
  it("returns null for missing rates and formats fractions as percent", () => {
    expect(formatWinRate(null)).toBeNull();
    expect(formatWinRate(0.624)).toBe("62");
    expect(formatWinRate(75)).toBe("75");
  });
});

describe("arenaCategoryLabel", () => {
  it("maps known categories and falls back to the raw value", () => {
    expect(arenaCategoryLabel("codecategories")).toBe("Code");
    expect(arenaCategoryLabel("uicomponent")).toBe("UI Component");
    expect(arenaCategoryLabel("gamedev")).toBe("Game Dev");
    expect(arenaCategoryLabel("dataviz")).toBe("Data Viz");
    expect(arenaCategoryLabel("custom-cat")).toBe("custom-cat");
  });
});

describe("performanceScore", () => {
  it("returns null when benchmark is missing or all indices are null", () => {
    expect(performanceScore(undefined)).toBeNull();
    expect(performanceScore(null)).toBeNull();
    expect(
      performanceScore({
        intelligenceIndex: null,
        codingIndex: null,
        agenticIndex: null,
        strengths: [],
        weaknesses: [],
      }),
    ).toBeNull();
  });

  it("averages only non-null indices", () => {
    expect(
      performanceScore({
        intelligenceIndex: 90,
        codingIndex: null,
        agenticIndex: null,
        strengths: [],
        weaknesses: [],
      }),
    ).toBe(90);
    expect(
      performanceScore({
        intelligenceIndex: 60,
        codingIndex: 90,
        agenticIndex: 75,
        strengths: [],
        weaknesses: [],
      }),
    ).toBe(75);
  });
});

describe("performanceScoreColor", () => {
  it("maps high scores to green and low scores to red", () => {
    expect(performanceScoreColor(100)).toBe("hsl(120.0 65% 42%)");
    expect(performanceScoreColor(50)).toBe("hsl(60.0 65% 42%)");
    expect(performanceScoreColor(0)).toBe("hsl(0.0 65% 42%)");
  });
});

describe("formatPerformanceScore", () => {
  it("rounds to an integer label", () => {
    expect(formatPerformanceScore(75.4)).toBe("75");
    expect(formatPerformanceScore(75.6)).toBe("76");
  });
});

describe("regionLabel", () => {
  it("maps known region codes", () => {
    expect(regionLabel("US")).toBe("United States");
    expect(regionLabel("cn")).toBe("China");
    expect(regionLabel("EU")).toBe("European Union");
    expect(regionLabel("APAC")).toBe("APAC");
  });
});
