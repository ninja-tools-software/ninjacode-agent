import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@ninjacode/providers";
import {
  mapGatewayModel,
  normalizeFavoriteModels,
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
      },
      known,
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
    });
    expect(mapped.price).toBeUndefined();
  });

  it("builds a remote-only model when absent from the static catalog", () => {
    const mapped = mapGatewayModel(
      { id: "new-model", label: "New", contextWindow: 64_000 },
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
    });
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
