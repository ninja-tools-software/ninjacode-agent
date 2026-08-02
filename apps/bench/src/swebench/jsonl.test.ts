import { describe, expect, it } from "vitest";
import { parsePredictionLines, serializePredictionLine } from "./jsonl.js";
import type { SweBenchPrediction } from "./types.js";

describe("jsonl", () => {
  it("round-trips prediction lines", () => {
    const prediction: SweBenchPrediction = {
      instance_id: "sympy__sympy-20590",
      model_name_or_path: "ninjacode/mock",
      model_patch: "diff --git a/foo b/foo\n",
    };
    const content = serializePredictionLine(prediction);
    expect(parsePredictionLines(content)).toEqual([prediction]);
  });
});
