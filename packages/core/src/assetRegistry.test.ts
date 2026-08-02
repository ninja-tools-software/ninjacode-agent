import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assetConfigPath, isAssetEnabled, loadAssetConfig, setAssetEnabled } from "./assetRegistry.js";

const dirs: string[] = [];

async function tmpWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-assets-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("asset registry", () => {
  it("treats a missing config as nothing disabled", async () => {
    const root = await tmpWorkspace();
    const config = await loadAssetConfig(root);
    expect(config).toEqual({ disabledSkills: [], disabledAgents: [], disabledRules: [] });
    expect(isAssetEnabled(config, "skill", "anything")).toBe(true);
  });

  it("persists and clears a disabled entry", async () => {
    const root = await tmpWorkspace();
    await setAssetEnabled(root, "skill", "canvas", false);
    expect(isAssetEnabled(await loadAssetConfig(root), "skill", "canvas")).toBe(false);

    await setAssetEnabled(root, "skill", "canvas", true);
    expect(isAssetEnabled(await loadAssetConfig(root), "skill", "canvas")).toBe(true);
  });

  it("keeps the families independent", async () => {
    const root = await tmpWorkspace();
    await setAssetEnabled(root, "agent", "reviewer", false);
    const config = await loadAssetConfig(root);
    expect(config.disabledAgents).toEqual(["reviewer"]);
    expect(isAssetEnabled(config, "skill", "reviewer")).toBe(true);
    expect(isAssetEnabled(config, "rule", "reviewer")).toBe(true);
  });

  it("preserves unrelated keys already in the file", async () => {
    const root = await tmpWorkspace();
    const file = assetConfigPath(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ somethingElse: 42 }), "utf8");

    await setAssetEnabled(root, "rule", "AGENTS.md", false);
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect(parsed.somethingElse).toBe(42);
    expect(parsed.disabledRules).toEqual(["AGENTS.md"]);
  });

  it("ignores a malformed config instead of failing discovery", async () => {
    const root = await tmpWorkspace();
    const file = assetConfigPath(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json", "utf8");
    expect(await loadAssetConfig(root)).toEqual({
      disabledSkills: [],
      disabledAgents: [],
      disabledRules: [],
    });
  });
});
