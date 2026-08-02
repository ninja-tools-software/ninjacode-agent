import { describe, expect, it } from "vitest";
import { isNearBottom, isUpwardKey, isUpwardWheel, NEAR_BOTTOM_PX } from "./scrollMetrics.js";

describe("isNearBottom", () => {
  it("is true when flush with the bottom", () => {
    expect(isNearBottom({ scrollTop: 400, scrollHeight: 500, clientHeight: 100 })).toBe(true);
  });

  it("is true within the near-bottom threshold", () => {
    expect(
      isNearBottom({ scrollTop: 400 - NEAR_BOTTOM_PX, scrollHeight: 500, clientHeight: 100 }),
    ).toBe(true);
  });

  it("is false just past the threshold", () => {
    expect(
      isNearBottom({ scrollTop: 400 - NEAR_BOTTOM_PX - 1, scrollHeight: 500, clientHeight: 100 }),
    ).toBe(false);
  });
});

describe("isUpwardKey", () => {
  it("recognises keys that move the viewport up", () => {
    expect(isUpwardKey("ArrowUp")).toBe(true);
    expect(isUpwardKey("PageUp")).toBe(true);
    expect(isUpwardKey("Home")).toBe(true);
  });

  it("ignores keys that move down or do not scroll", () => {
    expect(isUpwardKey("ArrowDown")).toBe(false);
    expect(isUpwardKey("PageDown")).toBe(false);
    expect(isUpwardKey("End")).toBe(false);
    expect(isUpwardKey("Enter")).toBe(false);
  });
});

describe("isUpwardWheel", () => {
  it("treats negative deltaY as upward", () => {
    expect(isUpwardWheel(-40)).toBe(true);
    expect(isUpwardWheel(40)).toBe(false);
    expect(isUpwardWheel(0)).toBe(false);
  });
});
