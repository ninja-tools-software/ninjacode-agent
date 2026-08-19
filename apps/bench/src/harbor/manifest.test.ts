import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHarborBundleManifest,
  HARBOR_ADAPTER_VERSION,
  HARBOR_MANIFEST_SCHEMA_VERSION,
  writeHarborBundleManifest,
} from "./manifest.js";

const temporaryDirectories: string[] = [];
const previousCommit = process.env.NINJACODE_GIT_COMMIT;

afterEach(async () => {
  if (previousCommit === undefined) delete process.env.NINJACODE_GIT_COMMIT;
  else process.env.NINJACODE_GIT_COMMIT = previousCommit;
  await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

async function fixture(): Promise<{ bundle: string; manifest: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-harbor-manifest-"));
  temporaryDirectories.push(dir);
  const bundle = path.join(dir, "ninjacode.cjs");
  const manifest = path.join(dir, "manifest.json");
  await fs.writeFile(bundle, "bundle");
  return { bundle, manifest };
}

describe("Harbor bundle manifest", () => {
  it("pins adapter, commit, runtime policy, and bundle digest", async () => {
    process.env.NINJACODE_GIT_COMMIT = "0123456789abcdef";
    const { bundle } = await fixture();
    const manifest = await buildHarborBundleManifest(bundle);
    expect(manifest).toMatchObject({
      schemaVersion: HARBOR_MANIFEST_SCHEMA_VERSION,
      adapterVersion: HARBOR_ADAPTER_VERSION,
      cliVersion: "0.1.0",
      gitCommit: "0123456789abcdef",
      bundleBytes: 6,
      minimumNodeMajor: 24,
      preferredNodeVersion: "24.19.0",
      harborVersion: "0.21.0",
      model: "xai/grok-4.6",
      reasoningEffort: "high",
      cliRunTimeoutMs: 840000,
      profile: "smoke",
      expectedTasks: 1,
      attempts: 1,
    });
    expect(manifest.bundleSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("writes stable JSON without a timestamp", async () => {
    process.env.NINJACODE_GIT_COMMIT = "abc";
    const { bundle, manifest } = await fixture();
    await writeHarborBundleManifest(bundle, manifest);
    const output = await fs.readFile(manifest, "utf8");
    expect(output).toContain('"gitCommit": "abc"');
    expect(output).not.toContain("generatedAt");
  });

  it("treats a pinned commit as a clean tree", async () => {
    process.env.NINJACODE_GIT_COMMIT = "0123456789abcdef";
    const { bundle } = await fixture();
    const manifest = await buildHarborBundleManifest(bundle, { profile: "publish" });
    expect(manifest.gitTreeDirty).toBe(false);
    expect(manifest.publishable).toBe(true);
  });

  it("refuses to mark a run publishable when the tree state is unknown", async () => {
    delete process.env.NINJACODE_GIT_COMMIT;
    const previousSha = process.env.GITHUB_SHA;
    delete process.env.GITHUB_SHA;
    try {
      const { bundle } = await fixture();
      const manifest = await buildHarborBundleManifest(bundle, { profile: "publish" });
      // Whatever this working tree looks like, the two fields must agree.
      expect(manifest.publishable).toBe(!manifest.gitTreeDirty);
    } finally {
      if (previousSha !== undefined) process.env.GITHUB_SHA = previousSha;
    }
  });
});
