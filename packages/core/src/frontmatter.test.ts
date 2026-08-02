import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

describe("stringifyFrontmatter", () => {
  it("round-trips through the parser", () => {
    const raw = stringifyFrontmatter(
      {
        name: "release-checklist",
        description: "Use when cutting a release",
        context: "fork",
        "allowed-tools": ["read_file", "grep"],
        alwaysApply: false,
      },
      "## Steps\n\n1. Bump the version",
    );

    const { data, body } = parseFrontmatter(raw);
    expect(data).toEqual({
      name: "release-checklist",
      description: "Use when cutting a release",
      context: "fork",
      "allowed-tools": ["read_file", "grep"],
      alwaysApply: false,
    });
    expect(body.trim()).toBe("## Steps\n\n1. Bump the version");
  });

  it("omits empty, null and undefined values", () => {
    const raw = stringifyFrontmatter(
      { name: "x", description: "", model: undefined, tools: [], handoffs: null },
      "body",
    );
    expect(parseFrontmatter(raw).data).toEqual({ name: "x" });
  });

  it("quotes scalars the parser would otherwise coerce", () => {
    const raw = stringifyFrontmatter({ a: "true", b: "42", c: "[not, an, array]" }, "body");
    expect(parseFrontmatter(raw).data).toEqual({ a: "true", b: "42", c: "[not, an, array]" });
  });

  it("uses the block form for array items containing commas or brackets", () => {
    const raw = stringifyFrontmatter({ globs: ["src/**/*.{ts,tsx}"] }, "body");
    expect(raw).toContain("globs:\n  - ");
    expect(parseFrontmatter(raw).data).toEqual({ globs: ["src/**/*.{ts,tsx}"] });
  });

  it("folds multi-line scalars, which the parser cannot represent", () => {
    const raw = stringifyFrontmatter({ description: "first\n  second" }, "body");
    expect(parseFrontmatter(raw).data).toEqual({ description: "first second" });
  });

  it("emits no fence when there is no metadata", () => {
    expect(stringifyFrontmatter({}, "just a body")).toBe("just a body\n");
  });
});
