import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_SESSION_ARTIFACT_BYTES,
  sessionArtifactPaths,
  sessionArtifactsDir,
  type SessionArtifactMeta,
} from "@ninjacode/tools";
import { ToolError } from "@ninjacode/tools";

const MAX_SESSION_BYTES = 128 * 1024 * 1024;

export interface PutArtifactOptions {
  kind: SessionArtifactMeta["kind"];
  mimeType?: string;
  toolName?: string;
  toolCallId?: string;
}

async function currentArtifactBytes(dir: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".bin")) continue;
    bytes += (await fs.stat(path.join(dir, entry.name))).size;
  }
  return bytes;
}

async function writeExclusive(file: string, content: string | Uint8Array): Promise<boolean> {
  try {
    await fs.writeFile(file, content, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

async function writeMetaAtomically(file: string, meta: SessionArtifactMeta): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try {
    await fs.link(tmp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

export class SessionArtifactStore {
  constructor(
    private readonly agentDir: string,
    private readonly sessionId: string,
  ) {}

  async putText(text: string, options: PutArtifactOptions): Promise<SessionArtifactMeta> {
    return this.put(new TextEncoder().encode(text), {
      ...options,
      mimeType: options.mimeType ?? "text/plain; charset=utf-8",
    });
  }

  async put(bytes: Uint8Array, options: PutArtifactOptions): Promise<SessionArtifactMeta> {
    if (bytes.byteLength > MAX_SESSION_ARTIFACT_BYTES) {
      throw new ToolError(
        `Artifact exceeds ${MAX_SESSION_ARTIFACT_BYTES} bytes`,
        "runtime",
      );
    }
    const id = crypto.createHash("sha256").update(bytes).digest("hex");
    const dir = sessionArtifactsDir(this.agentDir, this.sessionId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const files = sessionArtifactPaths(this.agentDir, this.sessionId, id);
    const isNew = await writeExclusive(files.body, bytes);
    if (isNew && (await currentArtifactBytes(dir)) > MAX_SESSION_BYTES) {
      await fs.unlink(files.body).catch(() => undefined);
      throw new ToolError(`Session artifact quota exceeds ${MAX_SESSION_BYTES} bytes`, "runtime");
    }
    const meta: SessionArtifactMeta = {
      id,
      sha256: id,
      byteLength: bytes.byteLength,
      mimeType: options.mimeType ?? "application/octet-stream",
      kind: options.kind,
      createdAt: new Date().toISOString(),
      toolName: options.toolName,
      toolCallId: options.toolCallId,
    };
    await writeMetaAtomically(files.meta, meta);
    return meta;
  }
}
