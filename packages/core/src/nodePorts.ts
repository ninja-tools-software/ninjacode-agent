import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { buildExecutionEnv, sandboxCommand } from "@ninjacode/tools";
import type { Clock, FileSystem, ProcessRunner } from "./ports.js";

export const nodeClock: Clock = {
  now(): number {
    return Date.now();
  },
};

export const nodeFileSystem: FileSystem = {
  readText(path: string): Promise<string> {
    return fs.readFile(path, "utf8");
  },

  async writeText(path: string, content: string): Promise<void> {
    await fs.writeFile(path, content, "utf8");
  },

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, options);
  },

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  },
};

export const nodeProcessRunner: ProcessRunner = {
  run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
      const env = buildExecutionEnv();
      const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
      const shellArgs =
        process.platform === "win32"
          ? ["/d", "/s", "/c", [cmd, ...args].join(" ")]
          : ["-lc", [cmd, ...args].join(" ")];
      const raw = opts.shell ? { command: shell, args: shellArgs } : { command: cmd, args };
      const wrapped = opts.sandbox
        ? sandboxCommand({
            ...raw,
            cwd: opts.cwd ?? opts.sandbox.workspaceRoot,
            workspaceRoot: opts.sandbox.workspaceRoot,
            agentDir: opts.sandbox.agentDir,
            mode: opts.sandbox.mode,
            allowNetwork: opts.sandbox.allowNetwork,
            env,
          })
        : { ...raw, sandboxed: false, backend: "none" as const };
      const child = spawn(wrapped.command, wrapped.args, {
        cwd: opts.cwd,
        env,
        detached: process.platform !== "win32",
      });
      let stdout = "";
      let stderr = "";
      const killTree = (signal: NodeJS.Signals = "SIGTERM") => {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            // fall back to the direct child
          }
        }
        child.kill(signal);
      };
      const onAbort = () => killTree();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("close", (code) => {
        opts.signal?.removeEventListener("abort", onAbort);
        resolve({ code: code ?? 1, stdout, stderr });
      });
      child.on("error", () => {
        opts.signal?.removeEventListener("abort", onAbort);
        resolve({ code: 1, stdout, stderr });
      });
    });
  },
};
