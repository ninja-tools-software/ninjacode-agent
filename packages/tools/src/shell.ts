import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Tool, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { truncateForModel } from "./output.js";
import { shellGrantScopes } from "./shellScope.js";
import { resolveInWorkspace } from "./paths.js";

interface PersistentShell {
  proc: ChildProcessWithoutNullStreams;
  cwd: string;
  buffer: string;
  waiters: Array<{
    marker: string;
    resolve: (output: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
}

const shells = new Map<string, PersistentShell>();
let markerSeq = 0;

function getOrCreateShell(sessionId: string, cwd: string, signal?: AbortSignal): PersistentShell {
  const existing = shells.get(sessionId);
  if (existing && !existing.proc.killed) return existing;

  const shellBin = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/bash");
  const isWin = process.platform === "win32";
  const proc = spawn(shellBin, isWin ? [] : ["-l"], {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0", PS1: "", PROMPT: "" },
    stdio: ["pipe", "pipe", "pipe"],
    signal,
  }) as ChildProcessWithoutNullStreams;

  const session: PersistentShell = {
    proc,
    cwd,
    buffer: "",
    waiters: [],
  };

  const onData = (chunk: Buffer) => {
    session.buffer += chunk.toString("utf8");
    // Check waiters for markers
    for (let i = session.waiters.length - 1; i >= 0; i--) {
      const w = session.waiters[i]!;
      const idx = session.buffer.indexOf(w.marker);
      if (idx !== -1) {
        const output = session.buffer.slice(0, idx);
        session.buffer = session.buffer.slice(idx + w.marker.length);
        clearTimeout(w.timer);
        session.waiters.splice(i, 1);
        w.resolve(output);
      }
    }
  };

  const rejectAllWaiters = (err: Error) => {
    for (const w of session.waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    session.waiters = [];
  };

  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  proc.on("error", (err) => {
    // e.g. AbortError when the spawn-time signal aborts
    rejectAllWaiters(
      err.name === "AbortError"
        ? new ToolError("Shell process aborted", "aborted")
        : new ToolError(err.message, "runtime"),
    );
  });
  proc.on("exit", () => {
    shells.delete(sessionId);
    rejectAllWaiters(new ToolError("Shell process exited", "runtime"));
  });

  shells.set(sessionId, session);
  return session;
}

export const shellTool: Tool = {
  name: "run_shell",
  description:
    "Run a shell command in the workspace. Use session_id to keep a persistent shell (cwd/env). Output truncated at 100KB.",
  risk: "shell",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string", description: "Relative working directory" },
      timeout_ms: { type: "number", description: "Timeout in ms (default 60000)" },
      session_id: {
        type: "string",
        description: "Optional session id for a persistent interactive shell",
      },
    },
    required: ["command"],
  },
  target(args) {
    return String(args.command ?? "");
  },
  grantScopes(args) {
    return shellGrantScopes(String(args.command ?? ""));
  },
  async execute(ctx, args): Promise<ToolResult> {
    const command = String(args.command ?? "");
    if (!command.trim()) throw new ToolError("Empty command", "invalid_args");

    let cwd = ctx.workspaceRoot;
    if (args.cwd) {
      try {
        cwd = resolveInWorkspace(ctx.workspaceRoot, String(args.cwd));
      } catch {
        throw new ToolError("cwd escapes workspace", "permission");
      }
    }

    const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : 60_000;
    const sessionId = args.session_id ? String(args.session_id) : undefined;

    if (!sessionId) {
      return oneshot(command, cwd, timeout, ctx.signal);
    }

    const shell = getOrCreateShell(sessionId, cwd, ctx.signal);
    if (args.cwd) {
      // Update cwd in the persistent shell
      await runInShell(shell, `cd ${shellQuote(cwd)}`, timeout, ctx.signal);
      shell.cwd = cwd;
    }

    const output = await runInShell(shell, command, timeout, ctx.signal);
    return {
      output: truncateForModel(output, 100_000),
      meta: { cwd: shell.cwd, command, sessionId, persistent: true },
    };
  },
};

function runInShell(
  shell: PersistentShell,
  command: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    return Promise.reject(new ToolError("Command aborted", "aborted"));
  }

  markerSeq += 1;
  const marker = `__NC_DONE_${markerSeq}_${Date.now()}__`;
  const isWin = process.platform === "win32";
  const wrapped = isWin
    ? `${command}\r\necho ${marker}\r\n`
    : `${command}\nprintf '\\n%s\\n' '${marker}'\n`;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    const timer = setTimeout(() => {
      const idx = shell.waiters.indexOf(waiter);
      if (idx >= 0) shell.waiters.splice(idx, 1);
      cleanup();
      reject(new ToolError(`Command timed out after ${timeout}ms`, "timeout"));
    }, timeout);

    const waiter = {
      marker,
      resolve: (out: string) => {
        cleanup();
        resolve(out.trimEnd());
      },
      reject: (e: Error) => {
        cleanup();
        reject(e);
      },
      timer,
    };

    const onAbort = () => {
      const idx = shell.waiters.indexOf(waiter);
      if (idx >= 0) shell.waiters.splice(idx, 1);
      clearTimeout(timer);
      // The whole agent run is being cancelled — kill the persistent shell too
      // so we don't leave an orphaned process behind.
      shell.proc.kill();
      reject(new ToolError("Command aborted", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    shell.waiters.push(waiter);
    shell.proc.stdin.write(wrapped);
  });
}

const ONESHOT_OUTPUT_MAX = 100_000;

interface OneshotCapture {
  stdout: string;
  stderr: string;
  aborted: boolean;
}

function attachOneshotOutput(child: ChildProcessWithoutNullStreams, capture: OneshotCapture): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    if (capture.stdout.length < ONESHOT_OUTPUT_MAX) capture.stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (capture.stderr.length < ONESHOT_OUTPUT_MAX) capture.stderr += chunk.toString("utf8");
  });
}

function formatOneshotOutput(
  code: number | null,
  capture: OneshotCapture,
  cwd: string,
  command: string,
): ToolResult {
  const output = [
    `exit_code: ${code ?? "null"}`,
    capture.stdout ? `--- stdout ---\n${truncateForModel(capture.stdout, ONESHOT_OUTPUT_MAX)}` : "",
    capture.stderr ? `--- stderr ---\n${truncateForModel(capture.stderr, ONESHOT_OUTPUT_MAX)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { output, meta: { exitCode: code, cwd, command } };
}

function oneshot(
  command: string,
  cwd: string,
  timeout: number,
  signal?: AbortSignal,
): Promise<ToolResult> {
  if (signal?.aborted) {
    return Promise.reject(new ToolError("Command aborted", "aborted"));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0" },
      signal,
    });

    const capture: OneshotCapture = { stdout: "", stderr: "", aborted: false };
    attachOneshotOutput(child, capture);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new ToolError(`Command timed out after ${timeout}ms`, "timeout"));
    }, timeout);

    const onAbort = () => {
      capture.aborted = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
      reject(new ToolError("Command aborted", "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    child.on("error", (err) => {
      cleanup();
      if (capture.aborted) return;
      if (err.name === "AbortError") {
        reject(new ToolError("Command aborted", "aborted"));
      } else {
        reject(new ToolError(err.message, "runtime"));
      }
    });

    child.on("close", (code) => {
      cleanup();
      if (capture.aborted) return;
      resolve(formatOneshotOutput(code, capture, cwd, command));
    });
  });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Kill and clear persistent shells (tests / session end). */
export function clearShellSessions(): void {
  for (const [, s] of shells) {
    s.proc.kill();
  }
  shells.clear();
}

export function killShellSession(sessionId: string): void {
  const s = shells.get(sessionId);
  if (s) {
    s.proc.kill();
    shells.delete(sessionId);
  }
}
