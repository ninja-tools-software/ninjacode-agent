import fs from "node:fs/promises";
import { spawn } from "node:child_process";
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
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        shell: opts.shell ?? false,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      let stdout = "";
      let stderr = "";
      const onAbort = () => child.kill("SIGTERM");
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
