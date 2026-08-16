import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { CloudJobV1 } from "./contract.js";

export interface EphemeralWorkspace {
  root: string;
  destroy(): Promise<void>;
}

export interface WorkspaceProvisioner {
  create(job: CloudJobV1, signal?: AbortSignal): Promise<EphemeralWorkspace>;
}

export class TempWorkspaceProvisioner implements WorkspaceProvisioner {
  constructor(private readonly root: string) {}

  async create(job: CloudJobV1, signal?: AbortSignal): Promise<EphemeralWorkspace> {
    signal?.throwIfAborted();
    if (job.workspace.kind !== "empty") throw new Error("unsupported workspace kind");
    await mkdir(this.root, { recursive: true });
    signal?.throwIfAborted();
    const workspaceRoot = await mkdtemp(path.join(this.root, `${job.id}-`));
    return {
      root: workspaceRoot,
      destroy: () => rm(workspaceRoot, { recursive: true, force: true }),
    };
  }
}
