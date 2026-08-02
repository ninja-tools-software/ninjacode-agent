import { describe, expect, it } from "vitest";
import { selectRoutes, type RouteCandidate } from "./selectRoutes.js";

function candidate(partial: Partial<RouteCandidate> & Pick<RouteCandidate, "provider">): RouteCandidate {
  return {
    modelId: "test",
    upstreamKind: "openai-compatible",
    baseUrl: "https://example.com",
    apiKey: "key",
    upstreamModel: "test-model",
    listPrice: { input: 1, output: 2 },
    costPrice: { input: 0.5, output: 1 },
    priority: 0,
    weight: 100,
    enabled: true,
    status: "active",
    healthStatus: "healthy",
    ...partial,
  };
}

describe("selectRoutes", () => {
  it("sorts by priority then weight", () => {
    const selected = selectRoutes([
      candidate({ provider: "b", priority: 10, weight: 50 }),
      candidate({ provider: "a", priority: 0, weight: 100 }),
    ]);
    expect(selected.map((r) => r.provider)).toEqual(["a", "b"]);
  });

  it("filters EU hosting region when requested", () => {
    const selected = selectRoutes(
      [
        candidate({ provider: "mistral", providerHostingRegion: "EU", providerJurisdiction: "EU" }),
        candidate({ provider: "openai", providerHostingRegion: "US" }),
      ],
      { hostingRegions: ["EU"], jurisdiction: "EU" },
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.provider).toBe("mistral");
  });

  it("skips routes without API keys", () => {
    const selected = selectRoutes([
      candidate({ provider: "a", apiKey: "" }),
      candidate({ provider: "b", priority: 1 }),
    ]);
    expect(selected.map((r) => r.provider)).toEqual(["b"]);
  });
});
