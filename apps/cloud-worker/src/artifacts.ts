import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { CloudJobV1 } from "./contract.js";
import type { AgentExecutionResult } from "./executor.js";
import type { ResolvedJobPolicy } from "./policy.js";

const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

export interface ArtifactManifest {
  version: 1;
  jobId: string;
  attempt: number;
  createdAt: string;
  completed: boolean;
  policy: ResolvedJobPolicy;
  result: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export interface ArtifactStore {
  persist(input: {
    job: CloudJobV1;
    attempt: number;
    workspaceRoot: string;
    policy: ResolvedJobPolicy;
    result: AgentExecutionResult;
  }): Promise<{ manifestPath: string; manifest: ArtifactManifest }>;
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`unsafe artifact path: ${value}`);
  }
  return normalized.replace(/^\.\//, "");
}

async function collectFiles(root: string, requested: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const safe = safeRelativePath(relative);
    const absolute = path.join(root, safe);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`artifact symlinks are not allowed: ${safe}`);
    if (info.isFile()) {
      files.push(safe);
      if (files.length > MAX_FILES) throw new Error(`artifact limit exceeds ${MAX_FILES} files`);
      return;
    }
    if (!info.isDirectory()) throw new Error(`unsupported artifact type: ${safe}`);
    for (const entry of (await readdir(absolute)).sort()) {
      await visit(path.posix.join(safe, entry));
    }
  };
  for (const item of requested) await visit(item);
  return [...new Set(files)].sort();
}

export class FileSystemArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async persist(input: {
    job: CloudJobV1;
    attempt: number;
    workspaceRoot: string;
    policy: ResolvedJobPolicy;
    result: AgentExecutionResult;
  }): Promise<{ manifestPath: string; manifest: ArtifactManifest }> {
    const destination = path.join(this.root, input.job.id, `attempt-${input.attempt}`);
    const staging = `${destination}.tmp`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(path.join(staging, "files"), { recursive: true });
    const requested = input.job.artifacts?.paths ?? [];
    const files = await collectFiles(input.workspaceRoot, requested);
    let totalBytes = 0;
    const entries: ArtifactManifest["files"] = [];
    for (const relative of files) {
      const source = path.join(input.workspaceRoot, relative);
      const data = await readFile(source);
      totalBytes += data.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`artifact limit exceeds ${MAX_TOTAL_BYTES} bytes`);
      }
      const target = path.join(staging, "files", relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      entries.push({
        path: relative,
        bytes: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
    const resultPath = path.join(staging, "result.json");
    await writeFile(resultPath, `${JSON.stringify(input.result, null, 2)}\n`, { mode: 0o600 });
    const manifest: ArtifactManifest = {
      version: 1,
      jobId: input.job.id,
      attempt: input.attempt,
      createdAt: new Date().toISOString(),
      completed: input.result.completed,
      policy: input.policy,
      result: "result.json",
      files: entries,
    };
    await writeFile(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    return { manifestPath: path.join(destination, "manifest.json"), manifest };
  }
}
