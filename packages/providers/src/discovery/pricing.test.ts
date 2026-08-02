import { describe, expect, it } from "vitest";
import { normalizeUpstreamPrice } from "./pricing.js";

describe("normalizeUpstreamPrice", () => {
  it("converts a per-token price to per-million", () => {
    expect(normalizeUpstreamPrice(0.000_003)).toBe(3);
  });

  it("rejects negative sentinel prices", () => {
    expect(normalizeUpstreamPrice(-1)).toBeUndefined();
    expect(normalizeUpstreamPrice("-1")).toBeUndefined();
  });

  it("rejects missing or non-numeric prices", () => {
    expect(normalizeUpstreamPrice(undefined)).toBeUndefined();
    expect(normalizeUpstreamPrice(null)).toBeUndefined();
    expect(normalizeUpstreamPrice("not-a-number")).toBeUndefined();
  });

  it("rejects values that would overflow numeric(12,6)", () => {
    expect(normalizeUpstreamPrice(2)).toBeUndefined();
  });

  it("accepts zero", () => {
    expect(normalizeUpstreamPrice(0)).toBe(0);
  });
});
