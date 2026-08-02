import { describe, expect, it } from "vitest";
import { MODE_META, nextMode } from "./modes.js";

describe("nextMode", () => {
  it("cycles forward through all modes", () => {
    let mode = MODE_META[0]!.id;
    for (let i = 1; i < MODE_META.length; i++) {
      mode = nextMode(mode);
      expect(mode).toBe(MODE_META[i]!.id);
    }
    expect(nextMode(mode)).toBe(MODE_META[0]!.id);
  });

  it("cycles backward through all modes", () => {
    let mode = MODE_META[0]!.id;
    for (let i = MODE_META.length - 1; i > 0; i--) {
      mode = nextMode(mode, true);
      expect(mode).toBe(MODE_META[i]!.id);
    }
    expect(nextMode(mode, true)).toBe(MODE_META[0]!.id);
  });
});
