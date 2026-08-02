/**
 * First-use download of the voice assets (whisper.cpp server binary + ggml
 * model) into the extension's global storage. Everything is fetched from a
 * versioned manifest with SHA-256 checksums so binaries can be hosted on a
 * plain GitHub release.
 *
 * This module must stay free of `vscode` imports so it is unit-testable.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

interface VoiceAssetRef {
  url: string;
  sha256: string;
}

interface VoiceManifest {
  version: number;
  /** Keyed by `${platform}-${arch}` (e.g. "darwin-arm64"). */
  binaries: Record<string, VoiceAssetRef>;
  /** Keyed by model name (e.g. "small", "base"). */
  models: Record<string, VoiceAssetRef>;
}

export interface VoiceAssets {
  binaryPath: string;
  modelPath: string;
}

type VoiceProgress = (label: string, percent: number | undefined) => void;

const SHA256_RE = /^[0-9a-f]{64}$/;

export function platformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

function isAssetRef(value: unknown): value is VoiceAssetRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.url === "string" &&
    /^https:\/\//.test(v.url) &&
    typeof v.sha256 === "string" &&
    SHA256_RE.test(v.sha256)
  );
}

/** Validate an untrusted manifest payload. Throws with a descriptive message. */
export function parseVoiceManifest(json: unknown): VoiceManifest {
  if (typeof json !== "object" || json === null) throw new Error("voice manifest: not an object");
  const m = json as Record<string, unknown>;
  if (typeof m.version !== "number") throw new Error("voice manifest: missing version");
  for (const section of ["binaries", "models"] as const) {
    const table = m[section];
    if (typeof table !== "object" || table === null) {
      throw new Error(`voice manifest: missing ${section}`);
    }
    for (const [key, ref] of Object.entries(table)) {
      if (!isAssetRef(ref)) {
        throw new Error(`voice manifest: invalid entry ${section}.${key} (need https url + sha256)`);
      }
    }
  }
  return {
    version: m.version,
    binaries: m.binaries as Record<string, VoiceAssetRef>,
    models: m.models as Record<string, VoiceAssetRef>,
  };
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Download `ref.url` to `dest` atomically (via a .part file) and verify its checksum. */
async function downloadVerified(opts: {
  ref: VoiceAssetRef;
  dest: string;
  label: string;
  onProgress: VoiceProgress;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const { ref, dest, label, onProgress, fetchImpl } = opts;
  const part = `${dest}.part`;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetchImpl(ref.url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`voice download failed for ${label}: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  const hash = createHash("sha256");
  let received = 0;
  const handle = await fs.open(part, "w");
  try {
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      await handle.write(chunk);
      received += chunk.length;
      onProgress(label, total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined);
    }
  } finally {
    await handle.close();
  }
  const digest = hash.digest("hex");
  if (digest !== ref.sha256) {
    await fs.rm(part, { force: true });
    throw new Error(`voice download checksum mismatch for ${label} (got ${digest.slice(0, 12)}…)`);
  }
  await fs.rename(part, dest);
}

interface EnsureVoiceAssetsOptions {
  /** Directory where assets are cached (the extension's globalStorage). */
  storageDir: string;
  manifestUrl: string;
  /** Model name from the manifest's `models` table. */
  model: string;
  onProgress?: VoiceProgress;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
}

/**
 * Ensure the whisper-server binary and requested model are present and
 * checksum-verified in `storageDir`. Downloads happen only on first use;
 * afterwards this resolves from a cheap existence check.
 */
export async function ensureVoiceAssets(opts: EnsureVoiceAssetsOptions): Promise<VoiceAssets> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const onProgress: VoiceProgress = opts.onProgress ?? (() => undefined);
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;

  const key = platformKey(platform, arch);
  const binaryName = platform === "win32" ? `whisper-server-${key}.exe` : `whisper-server-${key}`;
  const binaryPath = path.join(opts.storageDir, "voice", binaryName);
  const modelPath = path.join(opts.storageDir, "voice", `ggml-${opts.model}.bin`);

  if ((await fileExists(binaryPath)) && (await fileExists(modelPath))) {
    return { binaryPath, modelPath };
  }

  onProgress("Fetching voice manifest…", undefined);
  const res = await fetchImpl(opts.manifestUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`voice manifest fetch failed: HTTP ${res.status}`);
  const manifest = parseVoiceManifest(await res.json());

  const binaryRef = manifest.binaries[key];
  if (!binaryRef) {
    throw new Error(`voice dictation is not available for this platform (${key})`);
  }
  const modelRef = manifest.models[opts.model];
  if (!modelRef) {
    throw new Error(`voice model "${opts.model}" not found in manifest`);
  }

  if (!(await fileExists(binaryPath))) {
    await downloadVerified({
      ref: binaryRef,
      dest: binaryPath,
      label: "Downloading speech engine",
      onProgress,
      fetchImpl,
    });
    if (platform !== "win32") await fs.chmod(binaryPath, 0o755);
  }
  if (!(await fileExists(modelPath))) {
    await downloadVerified({
      ref: modelRef,
      dest: modelPath,
      label: `Downloading voice model (${opts.model})`,
      onProgress,
      fetchImpl,
    });
  }
  return { binaryPath, modelPath };
}
