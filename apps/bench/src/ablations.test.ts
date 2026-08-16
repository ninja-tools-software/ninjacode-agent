import { describe, expect, it } from "vitest";
import {
  ablationAgentOptions,
  ablationComponents,
  ablationPlan,
  resolveAblationVariant,
} from "./ablations.js";

describe("benchmark ablations", () => {
  it("disables exactly one component for isolated variants", () => {
    const variant = resolveAblationVariant("no-async-persistence");
    expect(variant.disabled).toEqual(["async-session-persistence"]);
    expect(ablationComponents(variant)["async-session-persistence"]).toBe(false);
    expect(ablationAgentOptions(variant)).toMatchObject({
      performance: { asyncSessionPersistence: false, parallelToolReads: true },
      enablePromptCache: true,
    });
  });

  it("renders non-executing quick, holdout, and public subset plans", () => {
    for (const scope of ["quick", "holdout", "public-subset"] as const) {
      const plan = ablationPlan(scope, "no-provider-cache");
      expect(plan.executed).toBe(false);
      expect(plan.run.join(" ")).toContain("no-provider-cache");
      expect(plan.compare).toContain("--require-single-ablation");
    }
  });
});
