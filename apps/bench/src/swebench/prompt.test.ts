import { describe, expect, it } from "vitest";
import { buildSweBenchPrompt } from "./prompt.js";
import type { SweBenchInstance } from "./types.js";

const baseInstance: SweBenchInstance = {
  instance_id: "sympy__sympy-20590",
  repo: "sympy/sympy",
  base_commit: "abc123",
  problem_statement: "Fix sympify to catch AttributeError.",
};

describe("buildSweBenchPrompt", () => {
  it("includes the issue statement and guardrails", () => {
    const prompt = buildSweBenchPrompt(baseInstance);
    expect(prompt).toContain("Fix sympify to catch AttributeError.");
    expect(prompt).toContain('repo="sympy/sympy"');
    expect(prompt).toContain("Do not modify or add test files");
  });

  it("includes hints when present", () => {
    const prompt = buildSweBenchPrompt({
      ...baseInstance,
      hints_text: "Look at sympify.py",
    });
    expect(prompt).toContain("<hints>");
    expect(prompt).toContain("Look at sympify.py");
  });
});
