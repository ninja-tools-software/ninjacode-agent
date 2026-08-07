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
  performanceBarWidth,
  performanceScore,
  regionLabel,
  scoreColor,
} from "./modelBenchmark.js";
import { METRIC_GREEN, METRIC_RED, METRIC_YELLOW, lerpRgb } from "./metricGradient.js";

const green = `rgb(${METRIC_GREEN[0]}, ${METRIC_GREEN[1]}, ${METRIC_GREEN[2]})`;
const yellow = `rgb(${METRIC_YELLOW[0]}, ${METRIC_YELLOW[1]}, ${METRIC_YELLOW[2]})`;
const red = `rgb(${METRIC_RED[0]}, ${METRIC_RED[1]}, ${METRIC_RED[2]})`;

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

describe("scoreColor", () => {
  it("maps low / mid / high scores on a 0–100 scale", () => {
    expect(scoreColor(10)).toBe(red);
    expect(scoreColor(30)).toBe(red);
    expect(scoreColor(50)).toBe(yellow);
    expect(scoreColor(70)).toBe(green);
    expect(scoreColor(100)).toBe(green);
  });

  it("interpolates between stops", () => {
    expect(scoreColor(40)).toBe(lerpRgb(METRIC_RED, METRIC_YELLOW, 0.5));
    expect(scoreColor(60)).toBe(lerpRgb(METRIC_YELLOW, METRIC_GREEN, 0.5));
  });

  it("scales bands proportionally when max is not 100", () => {
    expect(scoreColor(18, 60)).toBe(red);
    expect(scoreColor(30, 60)).toBe(yellow);
    expect(scoreColor(42, 60)).toBe(green);
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

describe("performanceBarWidth", () => {
  it("clamps a 0–100 score to a bar percent", () => {
    expect(performanceBarWidth(0)).toBe(0);
    expect(performanceBarWidth(50)).toBe(50);
    expect(performanceBarWidth(100)).toBe(100);
    expect(performanceBarWidth(-10)).toBe(0);
    expect(performanceBarWidth(140)).toBe(100);
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
