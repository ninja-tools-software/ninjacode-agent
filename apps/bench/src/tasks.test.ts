import { describe, expect, it } from "vitest";
import { matchesTaskFilter } from "./tasks.js";
import type { BenchTask } from "./types.js";

function task(partial: Partial<BenchTask> & { id: string }): BenchTask {
  return {
    description: "",
    category: "fix",
    difficulty: "easy",
    prompt: "",
    verify: "true",
    ...partial,
  };
}

describe("matchesTaskFilter", () => {
  it("matches everything when no filter is provided", () => {
    expect(matchesTaskFilter(task({ id: "a" }))).toBe(true);
    expect(matchesTaskFilter(task({ id: "a" }), undefined)).toBe(true);
  });

  it("filters by id list", () => {
    expect(matchesTaskFilter(task({ id: "a" }), { ids: ["a", "b"] })).toBe(true);
    expect(matchesTaskFilter(task({ id: "c" }), { ids: ["a", "b"] })).toBe(false);
  });

  it("filters by suite tag", () => {
    expect(matchesTaskFilter(task({ id: "a", suites: ["quick"] }), { suite: "quick" })).toBe(
      true,
    );
    expect(matchesTaskFilter(task({ id: "a", suites: ["full"] }), { suite: "quick" })).toBe(
      false,
    );
    expect(matchesTaskFilter(task({ id: "a" }), { suite: "quick" })).toBe(false);
  });

  it("applies id and suite filters together (AND)", () => {
    const t = task({ id: "fix-slugify", suites: ["quick"] });
    expect(matchesTaskFilter(t, { ids: ["fix-slugify"], suite: "quick" })).toBe(true);
    expect(matchesTaskFilter(t, { ids: ["other"], suite: "quick" })).toBe(false);
    expect(matchesTaskFilter(t, { ids: ["fix-slugify"], suite: "nightly" })).toBe(false);
  });
});
