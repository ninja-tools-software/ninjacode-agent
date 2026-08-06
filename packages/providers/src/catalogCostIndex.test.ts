import { describe, expect, it } from "vitest";
import { catalogCostIndex, sortModelsByCostIndex } from "./catalogCostIndex.js";

describe("catalogCostIndex", () => {
  it("sums input and output rounded to cents", () => {
    expect(catalogCostIndex({ input: 2.4, output: 12 })).toBe(14.4);
    expect(catalogCostIndex({ input: 0.1, output: 0.2 })).toBe(0.3);
    expect(catalogCostIndex({ input: 0.333, output: 0.333 })).toBe(0.67);
  });
});

describe("sortModelsByCostIndex", () => {
  it("puts auto first, then descending costIndex, nulls last", () => {
    const sorted = sortModelsByCostIndex([
      { id: "cheap", costIndex: 1 },
      { id: "auto", costIndex: null, tags: ["auto"] },
      { id: "pricey", costIndex: 50 },
      { id: "unknown", costIndex: null },
      { id: "mid", costIndex: 10 },
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["auto", "pricey", "mid", "cheap", "unknown"]);
  });
});
