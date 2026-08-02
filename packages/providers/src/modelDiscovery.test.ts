import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMammouthModels, MAMMOUTH_MODELS_URL } from "./modelDiscovery.js";

const SAMPLE = {
  object: "list",
  data: [
    {
      id: "claude-sonnet-5",
      object: "model",
      model_info: { max_input_tokens: 1_000_000, max_output_tokens: 128_000 },
    },
    {
      id: "mammouth-recommended",
      object: "model",
      model_info: { max_input_tokens: 1_048_576, max_output_tokens: 131_072 },
    },
    {
      // Missing model_info should fall back to defaults.
      id: "sonar-deep-research",
      object: "model",
      model_info: { max_input_tokens: 128_000, max_output_tokens: null },
    },
    {
      id: "text-embedding-3-large",
      object: "model",
      model_info: { max_input_tokens: 8191, max_output_tokens: null },
    },
    {
      id: "gpt-image-2",
      object: "model",
      model_info: { max_input_tokens: null, max_output_tokens: null },
    },
    {
      id: "gemini-2.5-flash-image",
      object: "model",
      model_info: { max_input_tokens: 32768, max_output_tokens: 32768 },
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchMammouthModels", () => {
  it("maps the /public/models payload into ModelInfo entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(MAMMOUTH_MODELS_URL);
        return { ok: true, json: async () => SAMPLE } as Response;
      }),
    );

    const models = await fetchMammouthModels();
    const ids = models.map((m) => m.id);

    expect(ids).toContain("claude-sonnet-5");
    expect(ids).toContain("mammouth-recommended");

    const sonnet = models.find((m) => m.id === "claude-sonnet-5");
    expect(sonnet?.contextWindow).toBe(1_000_000);
    expect(sonnet?.maxOutput).toBe(128_000);

    const sonar = models.find((m) => m.id === "sonar-deep-research");
    expect(sonar?.contextWindow).toBe(128_000);
    expect(sonar?.maxOutput).toBe(8_192);
  });

  it("filters out embedding and image models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => SAMPLE }) as Response),
    );

    const ids = (await fetchMammouthModels()).map((m) => m.id);
    expect(ids).not.toContain("text-embedding-3-large");
    expect(ids).not.toContain("gpt-image-2");
    expect(ids).not.toContain("gemini-2.5-flash-image");
  });

  it("returns an empty list on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as Response),
    );
    expect(await fetchMammouthModels()).toEqual([]);
  });

  it("returns an empty list when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await fetchMammouthModels()).toEqual([]);
  });
});
