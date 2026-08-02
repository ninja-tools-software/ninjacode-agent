import { describe, expect, it } from "vitest";
import { resolveModelPricing } from "./pricing.js";

describe("resolveModelPricing", () => {
  it("prices a Pass model from the gateway catalog", () => {
    const pricing = resolveModelPricing("deepseek-v4-flash");
    expect(pricing.input).toBeCloseTo(0.14);
    expect(pricing.output).toBeCloseTo(0.28);
    expect(pricing.cacheRead).toBeCloseTo(0.014);
  });

  it("prices a model addressed by its upstream name behind a route", () => {
    expect(resolveModelPricing("deepseek/deepseek-v4-pro").input).toBeCloseTo(0.55);
  });

  it("falls back to Anthropic list price for an unknown or absent model", () => {
    expect(resolveModelPricing(undefined).input).toBe(3);
    expect(resolveModelPricing("some-unlisted-model").output).toBe(15);
  });

  it("never prices a cheap model at the fallback rate", () => {
    // The bug this guards: a DeepSeek run billed at Sonnet rates reads 20x too high.
    expect(resolveModelPricing("deepseek-v4-flash").input).toBeLessThan(1);
  });
});
