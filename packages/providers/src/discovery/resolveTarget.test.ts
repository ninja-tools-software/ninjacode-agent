import { describe, expect, it } from "vitest";
import { resolveDiscoveredModelTarget } from "./resolveTarget.js";

describe("resolveDiscoveredModelTarget — slug fallback", () => {
  it("attaches to an existing model whose slug matches the sanitized upstream id", () => {
    const result = resolveDiscoveredModelTarget({
      upstreamModel: "claude-sonnet-4-5",
      providerSlug: "anthropic",
      existingModels: [{ id: "m1", slug: "claude-sonnet-4-5" }],
      existingRoutes: [],
      gatewayUpstreamModels: [],
    });
    expect(result).toEqual({ action: "attach", modelId: "m1", slug: "claude-sonnet-4-5" });
  });

  it("still creates when no route, gateway, or slug match exists", () => {
    const result = resolveDiscoveredModelTarget({
      upstreamModel: "brand-new-model",
      providerSlug: "openrouter",
      existingModels: [{ id: "m1", slug: "claude-sonnet-4-5" }],
      existingRoutes: [],
      gatewayUpstreamModels: [],
    });
    expect(result).toEqual({ action: "create", slug: "brand-new-model" });
  });
});
