import { describe, expect, it } from "vitest";
import { isDeprecationPast, shouldDeprecateModel, summarizeProposals } from "./deprecation.js";
import { reconcileDiscoveredRoutes } from "./reconcile.js";
import { resolveDiscoveredModelTarget } from "./resolveTarget.js";

describe("reconcileDiscoveredRoutes", () => {
  it("proposes new models", () => {
    const proposals = reconcileDiscoveredRoutes(
      [{ upstreamModel: "gpt-4o-mini", label: "GPT-4o mini" }],
      [],
    );
    expect(proposals).toEqual([
      {
        kind: "new",
        upstreamModel: "gpt-4o-mini",
        label: "GPT-4o mini",
        proposedCost: { input: 0, output: 0 },
        deprecationDate: undefined,
      },
    ]);
  });

  it("flags price drift", () => {
    const proposals = reconcileDiscoveredRoutes(
      [{ upstreamModel: "gpt-4o", inputPrice: 3, outputPrice: 12 }],
      [{ upstreamModel: "gpt-4o", costInputPrice: 2, costOutputPrice: 8, status: "active" }],
    );
    expect(proposals[0]?.kind).toBe("price_change");
  });

  it("flags missing upstream models", () => {
    const proposals = reconcileDiscoveredRoutes(
      [],
      [{ upstreamModel: "old-model", costInputPrice: 1, costOutputPrice: 2, status: "active" }],
    );
    expect(proposals[0]?.kind).toBe("missing");
  });

  it("flags deprecated models with future date", () => {
    const proposals = reconcileDiscoveredRoutes(
      [{ upstreamModel: "gpt-4o", deprecationDate: "2099-01-01" }],
      [{ upstreamModel: "gpt-4o", costInputPrice: 1, costOutputPrice: 2, status: "active" }],
      { now: new Date("2026-01-01") },
    );
    expect(proposals.some((p) => p.kind === "deprecated" && p.retireNow === false)).toBe(true);
  });

  it("flags deprecated models with past date as retireNow", () => {
    const proposals = reconcileDiscoveredRoutes(
      [{ upstreamModel: "gpt-4o", deprecationDate: "2020-01-01" }],
      [{ upstreamModel: "gpt-4o", costInputPrice: 1, costOutputPrice: 2, status: "active" }],
      { now: new Date("2026-01-01") },
    );
    const dep = proposals.find((p) => p.kind === "deprecated");
    expect(dep?.retireNow).toBe(true);
  });
});

describe("resolveDiscoveredModelTarget", () => {
  it("attaches when upstreamModel exists on another provider route", () => {
    const result = resolveDiscoveredModelTarget({
      upstreamModel: "deepseek/deepseek-v4-pro",
      providerSlug: "mammouth",
      existingModels: [{ id: "m1", slug: "deepseek-v4-pro" }],
      existingRoutes: [
        { modelId: "m1", providerId: "p-openrouter", upstreamModel: "deepseek/deepseek-v4-pro" },
      ],
      gatewayUpstreamModels: [],
    });
    expect(result).toEqual({ action: "attach", modelId: "m1", slug: "deepseek-v4-pro" });
  });

  it("attaches via gateway catalog upstream match", () => {
    const result = resolveDiscoveredModelTarget({
      upstreamModel: "deepseek/deepseek-v4-pro",
      providerSlug: "openrouter",
      existingModels: [{ id: "m1", slug: "deepseek-v4-pro" }],
      existingRoutes: [],
      gatewayUpstreamModels: [
        { modelSlug: "deepseek-v4-pro", upstreamModel: "deepseek/deepseek-v4-pro" },
      ],
    });
    expect(result.action).toBe("attach");
    expect(result.modelId).toBe("m1");
  });

  it("creates with sanitized slug when no match", () => {
    const result = resolveDiscoveredModelTarget({
      upstreamModel: "meta-llama/llama-3.1-70b",
      providerSlug: "openrouter",
      existingModels: [],
      existingRoutes: [],
      gatewayUpstreamModels: [],
    });
    expect(result).toEqual({ action: "create", slug: "meta-llama/llama-3.1-70b" });
  });
});

describe("deprecation helpers", () => {
  it("isDeprecationPast compares UTC dates", () => {
    expect(isDeprecationPast("2020-06-01", new Date("2026-01-01"))).toBe(true);
    expect(isDeprecationPast("2099-06-01", new Date("2026-01-01"))).toBe(false);
  });

  it("shouldDeprecateModel when no active routes", () => {
    expect(shouldDeprecateModel([{ status: "retired" }, { status: "proposed" }])).toBe(true);
    expect(shouldDeprecateModel([{ status: "active" }, { status: "retired" }])).toBe(false);
  });

  it("summarizeProposals counts kinds", () => {
    expect(
      summarizeProposals([
        { kind: "new" },
        { kind: "new" },
        { kind: "missing" },
        { kind: "deprecated" },
        { kind: "price_change" },
      ]),
    ).toEqual({ new: 2, missing: 1, deprecated: 1, price_change: 1 });
  });
});
