import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureVoiceAssets,
  parseVoiceManifest,
  platformKey,
  sha256File,
} from "./download.js";

describe("platformKey", () => {
  it("combines platform and arch", () => {
    expect(platformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(platformKey("win32", "x64")).toBe("win32-x64");
  });
});

const validRef = (sha = "a".repeat(64)) => ({ url: "https://example.com/x", sha256: sha });

describe("parseVoiceManifest", () => {
  it("accepts a valid manifest", () => {
    const m = parseVoiceManifest({
      version: 1,
      binaries: { "darwin-arm64": validRef() },
      models: { small: validRef("b".repeat(64)) },
    });
    expect(m.version).toBe(1);
    expect(m.binaries["darwin-arm64"]?.url).toBe("https://example.com/x");
  });

  it.each([
    [null, "not an object"],
    [{ binaries: {}, models: {} }, "missing version"],
    [{ version: 1, models: {} }, "missing binaries"],
    [{ version: 1, binaries: {}, models: { small: { url: "http://insecure", sha256: "a".repeat(64) } } }, "invalid entry"],
    [{ version: 1, binaries: { k: { url: "https://x", sha256: "nothex" } }, models: {} }, "invalid entry"],
  ])("rejects invalid payload %#", (payload, message) => {
    expect(() => parseVoiceManifest(payload)).toThrow(message);
  });
});

describe("sha256File", () => {
  it("hashes file contents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ninja-voice-"));
    const file = path.join(dir, "f.bin");
    await fs.writeFile(file, "hello");
    const expected = createHash("sha256").update("hello").digest("hex");
    await expect(sha256File(file)).resolves.toBe(expected);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("ensureVoiceAssets", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ninja-voice-assets-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const bodyOf = (text: string) => ({
    body: text,
    sha256: createHash("sha256").update(text).digest("hex"),
  });

  const makeFetch = (manifest: unknown, files: Record<string, string>) =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("manifest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      const content = files[u];
      if (content === undefined) return new Response("nope", { status: 404 });
      return new Response(content, { status: 200 });
    }) as typeof fetch;

  it("downloads, verifies and caches binary + model", async () => {
    const bin = bodyOf("binary-bytes");
    const model = bodyOf("model-bytes");
    const manifest = {
      version: 1,
      binaries: { "darwin-arm64": { url: "https://host/bin", sha256: bin.sha256 } },
      models: { small: { url: "https://host/model", sha256: model.sha256 } },
    };
    let fetchCount = 0;
    const fetchImpl: typeof fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount++;
      return makeFetch(manifest, { "https://host/bin": bin.body, "https://host/model": model.body })(...args);
    }) as typeof fetch;

    const progress: string[] = [];
    const assets = await ensureVoiceAssets({
      storageDir: dir,
      manifestUrl: "https://host/manifest.json",
      model: "small",
      platform: "darwin",
      arch: "arm64",
      fetchImpl,
      onProgress: (label) => progress.push(label),
    });
    await expect(fs.readFile(assets.binaryPath, "utf8")).resolves.toBe("binary-bytes");
    await expect(fs.readFile(assets.modelPath, "utf8")).resolves.toBe("model-bytes");
    expect(progress.length).toBeGreaterThan(0);
    const mode = (await fs.stat(assets.binaryPath)).mode & 0o111;
    expect(mode).not.toBe(0);

    // Second call: cache hit, no network.
    const before = fetchCount;
    await ensureVoiceAssets({
      storageDir: dir,
      manifestUrl: "https://host/manifest.json",
      model: "small",
      platform: "darwin",
      arch: "arm64",
      fetchImpl,
    });
    expect(fetchCount).toBe(before);
  });

  it("rejects on checksum mismatch and leaves no partial file", async () => {
    const manifest = {
      version: 1,
      binaries: { "darwin-arm64": { url: "https://host/bin", sha256: "c".repeat(64) } },
      models: { small: { url: "https://host/model", sha256: "d".repeat(64) } },
    };
    await expect(
      ensureVoiceAssets({
        storageDir: dir,
        manifestUrl: "https://host/manifest.json",
        model: "small",
        platform: "darwin",
        arch: "arm64",
        fetchImpl: makeFetch(manifest, { "https://host/bin": "tampered" }),
      }),
    ).rejects.toThrow("checksum mismatch");
    const leftovers = await fs.readdir(path.join(dir, "voice")).catch(() => []);
    expect(leftovers.filter((f) => !f.endsWith(".part"))).toEqual([]);
  });

  it("fails clearly on unsupported platforms", async () => {
    const manifest = { version: 1, binaries: {}, models: { small: validRef() } };
    await expect(
      ensureVoiceAssets({
        storageDir: dir,
        manifestUrl: "https://host/manifest.json",
        model: "small",
        platform: "freebsd",
        arch: "x64",
        fetchImpl: makeFetch(manifest, {}),
      }),
    ).rejects.toThrow("not available for this platform");
  });
});
