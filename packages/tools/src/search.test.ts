import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globTool, grepTool, searchCodebaseTool, matchGlob, expandBraceGlobs } from "./search.js";
import type { ToolContext } from "./types.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-search-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { workspaceRoot: dir, agentDir: dir, ...overrides };
}

describe("searchCodebaseTool", () => {
  it("uses ctx.codebaseIndex when present", async () => {
    const result = await searchCodebaseTool.execute(
      ctx({
        codebaseIndex: {
          search: () => [{ path: "src/foo.ts", score: 9.5, symbols: ["fooBar"] }],
        },
      }),
      { query: "foo bar" },
    );
    expect(result.output).toContain("src/foo.ts");
    expect(result.meta?.engine).toBe("index");
  });

  it("falls back to a grep/glob heuristic when no index is configured", async () => {
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src", "greeter.ts"),
      "export function sayHello() {\n  return \"hello world\";\n}\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "src", "other.ts"),
      "export const unrelated = 42;\n",
      "utf8",
    );

    const result = await searchCodebaseTool.execute(ctx(), { query: "sayHello" });
    expect(result.meta?.engine).toBe("fallback");
    expect(result.output).toContain("greeter.ts");
  });

  it("throws on an empty query", async () => {
    await expect(searchCodebaseTool.execute(ctx(), { query: "  " })).rejects.toMatchObject({
      code: "invalid_args",
    });
  });

  it("reports no matches gracefully", async () => {
    const result = await searchCodebaseTool.execute(
      ctx({ codebaseIndex: { search: () => [] } }),
      { query: "nothing_matches_this_zz" },
    );
    expect(result.output).toBe("(no matches)");
    expect(result.meta?.count).toBe(0);
  });
});

describe("globTool", () => {
  it("notes when the match cap is reached", async () => {
    await fs.mkdir(path.join(dir, "pkg"), { recursive: true });
    for (let i = 0; i < 205; i++) {
      await fs.writeFile(path.join(dir, "pkg", `file-${i}.txt`), "x", "utf8");
    }

    const result = await globTool.execute(ctx(), { pattern: "pkg/*.txt" });

    expect(result.output).toContain("[showing first 200 matches — narrow the pattern to see more]");
  });
});

describe("grepTool", () => {
  it("notes when the result cap is reached", async () => {
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    for (let i = 0; i < 60; i++) {
      await fs.writeFile(path.join(dir, "src", `m-${i}.ts`), `export const v${i} = "needle";\n`, "utf8");
    }

    const result = await grepTool.execute(ctx(), { pattern: "needle", path: "src", max_results: 50 });

    expect(result.output).toContain("[showing first 50 matches — raise max_results or narrow the pattern]");
    expect(result.meta?.count).toBe(50);
  });

  it("includes surrounding lines so a follow-up read is often unnecessary", async () => {
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "src", "app.ts"),
      "const a = 1;\nconst needle = 2;\nconst b = 3;\n",
      "utf8",
    );

    const result = await grepTool.execute(ctx(), { pattern: "needle", context_lines: 1 });
    expect(result.output).toMatch(/app\.ts-1-const a = 1;/);
    expect(result.output).toMatch(/app\.ts:2:const needle = 2;/);
    expect(result.output).toMatch(/app\.ts-3-const b = 3;/);
  });

  it("hints when a glob filter yields no matches", async () => {
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "app.ts"), "export const needle = 1;\n", "utf8");

    const result = await grepTool.execute(ctx(), { pattern: "needle", glob: "*.md" });
    expect(result.output).toContain("(no matches)");
    expect(result.output).toContain("glob");
  });
});

describe("matchGlob", () => {
  it("matches *.ts at any directory depth and expands braces", () => {
    expect(matchGlob("src/app.ts", "*.ts")).toBe(true);
    expect(matchGlob("app.ts", "*.ts")).toBe(true);
    expect(matchGlob("src/app.tsx", "*.ts")).toBe(false);
    expect(matchGlob("src/app.tsx", "*.{ts,tsx}")).toBe(true);
    expect(matchGlob("src/app.ts", "*.{ts,tsx}")).toBe(true);
    expect(expandBraceGlobs("*.{ts,tsx}")).toEqual(["*.ts", "*.tsx"]);
  });
});
