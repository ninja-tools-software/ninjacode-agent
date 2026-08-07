import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@ninjacode/providers";
import {
  mapGatewayModel,
  normalizeArenaScores,
  normalizeBenchmark,
  normalizeFavoriteModels,
  normalizeLlmStats,
  resolveSelectedModel,
} from "./gatewayModelMap.js";

const known: ModelInfo = {
  id: "gpt-5",
  label: "Static GPT-5",
  contextWindow: 200_000,
  maxOutput: 16_384,
  vision: false,
  reasoning: { kind: "levels", levels: ["low", "medium", "high"] },
  tags: ["static"],
  price: { input: 1, output: 2 },
};

describe("mapGatewayModel", () => {
  it("prefers API metadata over the static catalog entry and strips rates", () => {
    const mapped = mapGatewayModel(
      {
        id: "gpt-5",
        label: "GPT-5 (EU)",
        contextWindow: 400_000,
        maxOutput: 32_000,
        vision: true,
        hostingRegion: "EU",
        tags: ["pass"],
        costIndex: 22.5,
      },
      { ...known, costIndex: 3 },
      "pro",
    );
    expect(mapped).toMatchObject({
      id: "gpt-5",
      label: "GPT-5 (EU)",
      contextWindow: 400_000,
      maxOutput: 32_000,
      vision: true,
      hostingRegion: "EU",
      catalog: "pro",
      tags: ["pass"],
      reasoning: known.reasoning,
      costIndex: 22.5,
    });
    expect(mapped.price).toBeUndefined();
  });

  it("keeps API null costIndex over a catalog fallback", () => {
    const mapped = mapGatewayModel(
      { id: "auto", label: "Auto", costIndex: null },
      { ...known, id: "auto", costIndex: 1 },
    );
    expect(mapped.costIndex).toBeNull();
  });

  it("falls back to catalog costIndex when the wire omits it", () => {
    const mapped = mapGatewayModel(
      { id: "gpt-5", label: "GPT-5" },
      { ...known, costIndex: 10 },
    );
    expect(mapped.costIndex).toBe(10);
  });

  it("builds a remote-only model when absent from the static catalog", () => {
    const mapped = mapGatewayModel(
      { id: "new-model", label: "New", contextWindow: 64_000, costIndex: 5 },
      undefined,
      "free",
    );
    expect(mapped).toEqual({
      id: "new-model",
      label: "New",
      contextWindow: 64_000,
      maxOutput: 8_192,
      vision: undefined,
      hostingRegion: null,
      catalog: "free",
      tags: [],
      costIndex: 5,
      benchmark: null,
      llmStats: null,
      arenaScores: [],
    });
  });

  it("passes through normalized benchmark and arenaScores from the wire", () => {
    const mapped = mapGatewayModel(
      {
        id: "gpt-5",
        benchmark: {
          intelligenceIndex: 88,
          codingIndex: 91,
          agenticIndex: 70,
          strengths: ["coding", "coding", "unknown"],
          weaknesses: ["agentic"],
        },
        arenaScores: [
          { arena: "Design Arena", category: "codecategories", elo: 1200, winRate: 0.62 },
          { arena: "Design Arena", category: "bad", elo: "x", winRate: 0.1 },
        ],
      },
      known,
    );
    expect(mapped.benchmark).toEqual({
      intelligenceIndex: 88,
      codingIndex: 91,
      agenticIndex: 70,
      strengths: ["coding"],
      weaknesses: ["agentic"],
    });
    expect(mapped.arenaScores).toEqual([
      { arena: "Design Arena", category: "codecategories", elo: 1200, winRate: 0.62 },
    ]);
  });

  it("passes through normalized llmStats from the wire", () => {
    const mapped = mapGatewayModel(
      {
        id: "gpt-5",
        llmStats: {
          score: 52.3,
          reasoningIndex: 48,
          codingIndex: 49.6,
          agentIndex: 43.7,
        },
      },
      known,
    );
    expect(mapped.llmStats).toEqual({
      score: 52.3,
      reasoningIndex: 48,
      codingIndex: 49.6,
      agentIndex: 43.7,
    });
  });

  it("attaches benchmark data on remote-only models", () => {
    const mapped = mapGatewayModel(
      {
        id: "remote",
        label: "Remote",
        benchmark: {
          intelligenceIndex: 50,
          codingIndex: null,
          agenticIndex: null,
          strengths: [],
          weaknesses: [],
        },
        arenaScores: [],
      },
      undefined,
    );
    expect(mapped.benchmark?.intelligenceIndex).toBe(50);
    expect(mapped.llmStats).toBeNull();
    expect(mapped.arenaScores).toEqual([]);
  });
});

describe("normalizeBenchmark", () => {
  it("returns null for absent or empty payloads", () => {
    expect(normalizeBenchmark(undefined)).toBeNull();
    expect(normalizeBenchmark(null)).toBeNull();
    expect(normalizeBenchmark({})).toBeNull();
    expect(
      normalizeBenchmark({
        intelligenceIndex: null,
        codingIndex: null,
        agenticIndex: null,
        strengths: [],
        weaknesses: [],
      }),
    ).toBeNull();
  });

  it("clamps out-of-range indices to null and filters domains", () => {
    expect(
      normalizeBenchmark({
        intelligenceIndex: 120,
        codingIndex: -1,
        agenticIndex: 55.5,
        strengths: ["intelligence", "nope"],
        weaknesses: ["coding"],
      }),
    ).toEqual({
      intelligenceIndex: null,
      codingIndex: null,
      agenticIndex: 55.5,
      strengths: ["intelligence"],
      weaknesses: ["coding"],
    });
  });
});

describe("normalizeLlmStats", () => {
  it("returns null for absent or empty payloads", () => {
    expect(normalizeLlmStats(undefined)).toBeNull();
    expect(normalizeLlmStats(null)).toBeNull();
    expect(normalizeLlmStats({})).toBeNull();
    expect(
      normalizeLlmStats({
        score: null,
        reasoningIndex: null,
        codingIndex: null,
        agentIndex: null,
      }),
    ).toBeNull();
  });

  it("clamps out-of-range values to null", () => {
    expect(
      normalizeLlmStats({
        score: 61,
        reasoningIndex: -1,
        codingIndex: 55.5,
        agentIndex: 40,
      }),
    ).toEqual({
      score: null,
      reasoningIndex: null,
      codingIndex: 55.5,
      agentIndex: 40,
    });
  });
});

describe("normalizeArenaScores", () => {
  it("returns [] for non-arrays and drops entries without numeric elo", () => {
    expect(normalizeArenaScores(null)).toEqual([]);
    expect(normalizeArenaScores({})).toEqual([]);
    expect(
      normalizeArenaScores([
        { arena: "A", category: "c", elo: 100, winRate: null },
        { arena: "A", category: "c", elo: "bad", winRate: 0.5 },
        { arena: "A", category: "c", elo: 200, winRate: "x" },
      ]),
    ).toEqual([
      { arena: "A", category: "c", elo: 100, winRate: null },
      { arena: "A", category: "c", elo: 200, winRate: null },
    ]);
  });
});

describe("resolveSelectedModel", () => {
  const models: ModelInfo[] = [
    { id: "auto", label: "Auto", contextWindow: 200_000, maxOutput: 16_384 },
    { id: "gpt-5", label: "GPT-5", contextWindow: 200_000, maxOutput: 16_384 },
  ];

  it("maps retired Auto aliases to auto", () => {
    expect(resolveSelectedModel("auto-balanced", models)).toEqual({
      model: "auto",
      modelInfo: models[0],
      corrected: true,
    });
    expect(resolveSelectedModel("auto-frontier", models).model).toBe("auto");
  });

  it("keeps a model that is still in the live list", () => {
    expect(resolveSelectedModel("gpt-5", models)).toEqual({
      model: "gpt-5",
      modelInfo: models[1],
      corrected: false,
    });
  });

  it("falls back to the first live model when the stored id is gone", () => {
    expect(resolveSelectedModel("vanished", models)).toEqual({
      model: "auto",
      modelInfo: models[0],
      corrected: true,
    });
  });
});

describe("normalizeFavoriteModels", () => {
  const models: ModelInfo[] = [
    { id: "auto", label: "Auto", contextWindow: 200_000, maxOutput: 16_384 },
    { id: "gpt-5", label: "GPT-5", contextWindow: 200_000, maxOutput: 16_384 },
  ];

  it("remaps retired Auto favorites and drops unknowns", () => {
    expect(
      normalizeFavoriteModels(["auto-frontier", "gpt-5", "gone", "auto"], models),
    ).toEqual(["auto", "gpt-5"]);
  });
});
