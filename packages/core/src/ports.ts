import type { SandboxMode } from "@ninjacode/tools";

export interface Clock {
  now(): number;
}

export interface FileSystem {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface ProcessRunOptions {
  cwd?: string;
  signal?: AbortSignal;
  shell?: boolean;
  sandbox?: {
    workspaceRoot: string;
    agentDir: string;
    mode: SandboxMode;
    allowNetwork?: boolean;
  };
}

export interface ProcessRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProcessRunner {
  run(cmd: string, args: string[], opts?: ProcessRunOptions): Promise<ProcessRunResult>;
}
