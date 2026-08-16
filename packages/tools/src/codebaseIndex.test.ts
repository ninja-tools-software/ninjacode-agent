import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodebaseIndex } from "./codebaseIndex.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-index-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

describe("CodebaseIndex.build + search", () => {
  it("ranks files mentioning the query term higher than unrelated files", async () => {
    await write(
      "src/authService.ts",
      "export function authenticateUser(token: string) {\n  // verifies the auth token\n  return token.length > 0;\n}\n",
    );
    await write(
      "src/mathUtils.ts",
      "export function add(a: number, b: number) {\n  return a + b;\n}\n",
    );

    const index = new CodebaseIndex(dir);
    await index.build();

    const hits = await index.search("authenticate user token");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe("src/authService.ts");
  });

  it("extracts heuristic symbols and boosts matches on symbol names", async () => {
    await write(
      "src/widget.ts",
      "export class WidgetRenderer {\n  render() {}\n}\n\nexport function createWidget() {}\n",
    );
    await write("src/unrelated.ts", "export const nothing = 1;\n");

    const index = new CodebaseIndex(dir);
    await index.build();

    const hits = await index.search("WidgetRenderer");
    expect(hits[0]?.path).toBe("src/widget.ts");
    expect(hits[0]?.symbols).toContain("WidgetRenderer");
    expect(hits[0]?.symbol).toBe("WidgetRenderer");
    expect(hits[0]?.startLine).toBe(1);
  });

  it("respects .gitignore and skips default ignore directories", async () => {
    await write(".gitignore", "ignored-dir/\nsecret.ts\n");
    await write("ignored-dir/thing.ts", "export const shouldNotBeFound = \"zzzsecretvalue987\";\n");
    await write("secret.ts", "export const alsoHidden = \"zzzsecretvalue987\";\n");
    await write("node_modules/pkg/index.js", "module.exports = \"zzzsecretvalue987\";\n");
    await write("src/visible.ts", "export const ok = true;\n");

    const index = new CodebaseIndex(dir);
    await index.build();

    const hits = await index.search("zzzsecretvalue987");
    expect(hits).toHaveLength(0);
    expect(index.listFiles().some((f) => f.path.startsWith("ignored-dir"))).toBe(false);
    expect(index.listFiles().some((f) => f.path === "secret.ts")).toBe(false);
    expect(index.listFiles().some((f) => f.path.startsWith("node_modules"))).toBe(false);
    expect(index.listFiles().some((f) => f.path === "src/visible.ts")).toBe(true);
  });

  it("supports incremental refresh and removal without a full rebuild", async () => {
    await write("src/a.ts", "export const alpha = 1;\n");
    const index = new CodebaseIndex(dir);
    await index.build();
    await expect(index.search("alpha")).resolves.toHaveLength(1);

    await write("src/b.ts", "export function betaHandler() {}\n");
    await index.refreshFile("src/b.ts");
    expect((await index.search("betaHandler"))[0]?.path).toBe("src/b.ts");

    await fs.rm(path.join(dir, "src/a.ts"));
    await index.removeFile("src/a.ts");
    await expect(index.search("alpha")).resolves.toHaveLength(0);
  });

  it("semanticSearch is a safe no-op without an embedding provider", async () => {
    await write("src/a.ts", "export const alpha = 1;\n");
    const index = new CodebaseIndex(dir);
    await index.build();
    expect(index.hasSemanticLayer).toBe(false);
    await expect(index.semanticSearch("alpha")).resolves.toEqual([]);
  });

  it("ranks via a supplied embedding provider when configured", async () => {
    await write("src/a.ts", "export const alpha = 1;\n");
    await write("src/b.ts", "export const beta = 2;\n");

    const index = new CodebaseIndex(dir, {
      embeddingProvider: {
        name: "fake",
        async embed(texts) {
          // Deterministic fake embedding: vector = [charCodeSum, textLength]
          return texts.map((t) => [
            [...t].reduce((s, c) => s + c.charCodeAt(0), 0) % 997,
            t.length,
          ]);
        },
      },
    });
    await index.build();
    expect(index.hasSemanticLayer).toBe(true);
    const hits = await index.semanticSearch("alpha");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("builds lazily, persists locally, and invalidates changed mtimes", async () => {
    await write("src/lazy.ts", "export function alphaBeacon() { return 1; }\n");
    const cachePath = path.join(dir, ".cache", "index.json");
    const first = new CodebaseIndex(dir, { cachePath, rescanIntervalMs: 0 });
    expect(first.isBuilt).toBe(false);
    expect((await first.search("alphaBeacon"))[0]?.path).toBe("src/lazy.ts");
    expect(first.isBuilt).toBe(true);
    await expect(fs.stat(cachePath)).resolves.toBeDefined();

    const restored = new CodebaseIndex(dir, { cachePath, rescanIntervalMs: 0 });
    expect(restored.isBuilt).toBe(false);
    expect((await restored.search("alphaBeacon"))[0]?.path).toBe("src/lazy.ts");

    await write("src/lazy.ts", "export function omegaWidget() { return 2; }\n");
    const future = new Date(Date.now() + 2_000);
    await fs.utimes(path.join(dir, "src/lazy.ts"), future, future);
    expect((await restored.search("omegaWidget"))[0]?.symbol).toBe("omegaWidget");
    await expect(restored.search("alphaBeacon")).resolves.toHaveLength(0);
  });
});
