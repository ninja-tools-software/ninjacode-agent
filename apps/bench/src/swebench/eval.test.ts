import { describe, expect, it } from "vitest";
import { parseEvalSummary } from "./eval.js";

/** Shape actually written by `swebench.harness.run_evaluation` (schema v2). */
const HARNESS_REPORT = JSON.stringify({
  total_instances: 4,
  resolved_instances: 1,
  completed_ids: ["sympy__sympy-20590", "django__django-1234"],
  resolved_ids: ["sympy__sympy-20590"],
  unresolved_ids: ["django__django-1234"],
  empty_patch_ids: ["requests__requests-999"],
  error_ids: [],
  incomplete_ids: ["astropy__astropy-12907"],
  schema_version: 2,
});

describe("parseEvalSummary", () => {
  it("reads the harness id lists", () => {
    const summary = parseEvalSummary("", HARNESS_REPORT);
    expect(summary.resolved).toEqual(["sympy__sympy-20590"]);
    expect(summary.unresolved).toContain("django__django-1234");
  });

  it("counts an empty patch as unresolved, not as a harness error", () => {
    const summary = parseEvalSummary("", HARNESS_REPORT);
    expect(summary.unresolved).toContain("requests__requests-999");
    expect(summary.errors).not.toContain("requests__requests-999");
  });

  it("keeps instances the harness could not run in their own bucket", () => {
    const summary = parseEvalSummary("", HARNESS_REPORT);
    expect(summary.errors).toEqual(["astropy__astropy-12907"]);
  });

  it("falls back to stdout patterns when there is no report", () => {
    const stdout = "resolved sympy__sympy-20590 in 12.3s\nunresolved django__django-1";
    const summary = parseEvalSummary(stdout);
    expect(summary.resolved).toContain("sympy__sympy-20590");
  });

  it("falls back to stdout when the report has no id lists", () => {
    const summary = parseEvalSummary("resolved sympy__sympy-20590", JSON.stringify({ total: 0 }));
    expect(summary.resolved).toEqual(["sympy__sympy-20590"]);
  });
});
