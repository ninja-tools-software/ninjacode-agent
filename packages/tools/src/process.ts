import { spawn } from "node:child_process";
import { ToolError } from "./types.js";

interface SpawnCaptureOptions {
  cwd: string;
  signal?: AbortSignal;
  /** Run through the platform shell. Needed on Windows for `.cmd` wrappers. */
  shell?: boolean;
  maxStdout?: number;
  maxStderr?: number;
}

interface CapturedProcess {
  code: number;
  stdout: string;
  stderr: string;
}

const MAX_STDOUT = 500_000;
const MAX_STDERR = 50_000;

/**
 * Spawn a process and capture its output, bounded so a runaway command cannot
 * exhaust memory. Resolves on exit whatever the exit code — a non-zero code is
 * information for the caller, not an exception.
 */
export function spawnCapture(
  bin: string,
  args: string[],
  options: SpawnCaptureOptions,
): Promise<CapturedProcess> {
  const { cwd, signal, shell = false, maxStdout = MAX_STDOUT, maxStderr = MAX_STDERR } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, signal, shell });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < maxStdout) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < maxStderr) stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      if (error.name === "AbortError") {
        reject(new ToolError(`${bin} aborted`, "aborted"));
        return;
      }
      reject(new ToolError(`${bin} failed: ${error.message}`, "runtime"));
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
