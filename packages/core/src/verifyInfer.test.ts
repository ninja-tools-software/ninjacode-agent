import { describe, expect, it } from "vitest";
import { inferVerifyCommands } from "./verifyInfer.js";

describe("inferVerifyCommands", () => {
  it("orders node scripts cheapest first and uses the lockfile's package manager", () => {
    expect(
      inferVerifyCommands({
        entries: ["package.json", "pnpm-lock.yaml"],
        scripts: { test: "vitest", build: "tsc", lint: "eslint .", typecheck: "tsc --noEmit" },
      }),
    ).toEqual(["pnpm run typecheck", "pnpm run lint", "pnpm run test"]);
  });

  it("falls back to npm when no lockfile identifies a manager", () => {
    expect(
      inferVerifyCommands({ entries: ["package.json"], scripts: { lint: "eslint ." } }),
    ).toEqual(["npm run lint"]);
  });

  it("recognises each lockfile", () => {
    const cases: Array<[string, string]> = [
      ["yarn.lock", "yarn"],
      ["bun.lockb", "bun"],
      ["package-lock.json", "npm"],
    ];
    for (const [lockfile, manager] of cases) {
      expect(
        inferVerifyCommands({ entries: ["package.json", lockfile], scripts: { test: "x" } }),
      ).toEqual([`${manager} run test`]);
    }
  });

  it("accepts the common aliases of the typecheck script", () => {
    expect(inferVerifyCommands({ entries: [], scripts: { "type-check": "tsc" } })).toEqual([
      "npm run type-check",
    ]);
  });

  it("only suggests scripts the workspace actually defines", () => {
    expect(inferVerifyCommands({ entries: ["package.json"], scripts: { build: "tsc" } })).toEqual(
      [],
    );
  });

  it("handles rust, go and python workspaces", () => {
    expect(inferVerifyCommands({ entries: ["Cargo.toml", "src"] })).toEqual(["cargo check"]);
    expect(inferVerifyCommands({ entries: ["go.mod"] })).toEqual(["go build ./..."]);
    expect(
      inferVerifyCommands({
        entries: ["pyproject.toml"],
        pyproject: "[tool.ruff]\nline-length = 100\n[tool.mypy]\nstrict = true\n",
      }),
    ).toEqual(["ruff check .", "mypy ."]);
  });

  it("ignores a pyproject that configures neither linter", () => {
    expect(
      inferVerifyCommands({ entries: ["pyproject.toml"], pyproject: "[project]\nname = 'x'\n" }),
    ).toEqual([]);
  });

  it("caps a polyglot workspace at three commands", () => {
    const commands = inferVerifyCommands({
      entries: ["package.json", "pnpm-lock.yaml", "Cargo.toml", "go.mod"],
      scripts: { typecheck: "tsc", lint: "eslint", test: "vitest" },
    });
    expect(commands).toHaveLength(3);
    expect(commands).toEqual(["pnpm run typecheck", "pnpm run lint", "pnpm run test"]);
  });

  it("returns nothing for an unrecognisable workspace", () => {
    expect(inferVerifyCommands({ entries: ["README.md"] })).toEqual([]);
  });
});
