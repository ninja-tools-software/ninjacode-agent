import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SandboxMode } from "./types.js";
import { ToolError } from "./types.js";

const SAFE_ENV_KEYS = new Set([
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "CI",
  "NO_COLOR",
  "TMPDIR",
  "TMP",
  "TEMP",
]);

const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)/i;
const SENSITIVE_HOME_DIRS = [".ssh", ".aws", ".azure", ".config/gcloud", ".kube", ".docker"];

export interface SandboxCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  workspaceRoot: string;
  agentDir: string;
  mode: SandboxMode;
  allowNetwork?: boolean;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  sessionId?: string;
}

export interface SandboxedCommand {
  command: string;
  args: string[];
  sandboxed: boolean;
  backend: "none" | "seatbelt" | "bubblewrap" | "srt";
}

export class SandboxViolation extends ToolError {
  constructor(
    message: string,
    readonly resource: string,
    readonly rule: string,
    readonly requiredPermission: string,
  ) {
    super(message, "permission");
    this.name = "SandboxViolation";
  }
}

export function buildExecutionEnv(
  host: NodeJS.ProcessEnv = process.env,
  explicit: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (host[key] !== undefined && !SECRET_ENV.test(key)) env[key] = host[key];
  }
  env.TMPDIR = "/tmp";
  env.TMP = "/tmp";
  env.TEMP = "/tmp";
  env.HOME = "/tmp";
  env.FORCE_COLOR = "0";
  for (const [key, value] of Object.entries(explicit)) env[key] = value;
  return env;
}

function quoteSeatbelt(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function canonicalSandboxPath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    const parent = path.dirname(value);
    try {
      return path.join(fs.realpathSync.native(parent), path.basename(value));
    } catch {
      return path.resolve(value);
    }
  }
}

function seatbeltSubpath(operation: string, value: string): string {
  return `(${operation} (subpath "${quoteSeatbelt(canonicalSandboxPath(value))}"))`;
}

function sensitiveHomeRoots(env: NodeJS.ProcessEnv | undefined): string[] {
  return [...new Set([os.homedir(), env?.HOME].filter((home): home is string => Boolean(home)))];
}

export function buildSeatbeltProfile(opts: SandboxCommandOptions): string {
  const lines = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow file-read*)",
  ];
  for (const home of sensitiveHomeRoots(opts.env)) {
    for (const rel of SENSITIVE_HOME_DIRS) {
      lines.push(seatbeltSubpath("deny file-read*", path.join(home, rel)));
    }
  }
  for (const name of [".env", ".env.local", ".env.production", ".npmrc", ".pypirc"]) {
    const sensitivePath = canonicalSandboxPath(path.join(opts.workspaceRoot, name));
    lines.push(`(deny file-read* (literal "${quoteSeatbelt(sensitivePath)}"))`);
  }
  lines.push(seatbeltSubpath("allow file-write*", opts.agentDir));
  if (opts.mode === "workspace-write") {
    lines.push(seatbeltSubpath("allow file-write*", opts.workspaceRoot));
  }
  lines.push(seatbeltSubpath("allow file-write*", os.tmpdir()));
  lines.push(opts.allowNetwork ? "(allow network*)" : "(deny network*)");
  return `${lines.join("\n")}\n`;
}

function findExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next PATH entry
    }
  }
  return null;
}

function maskPathArgs(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  return fs.statSync(target).isDirectory()
    ? ["--tmpfs", target]
    : ["--ro-bind", "/dev/null", target];
}

export function buildBubblewrapArgs(opts: SandboxCommandOptions): string[] {
  const args = ["--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev"];
  if (!opts.allowNetwork) args.push("--unshare-net");
  args.push("--tmpfs", "/tmp");
  if (opts.mode === "workspace-write") {
    args.push("--bind", opts.workspaceRoot, opts.workspaceRoot);
  } else {
    args.push("--ro-bind", opts.workspaceRoot, opts.workspaceRoot);
  }
  if (!path.resolve(opts.agentDir).startsWith(`${path.resolve(opts.workspaceRoot)}${path.sep}`)) {
    args.push("--bind", opts.agentDir, opts.agentDir);
  }
  for (const home of sensitiveHomeRoots(opts.env)) {
    for (const rel of SENSITIVE_HOME_DIRS) args.push(...maskPathArgs(path.join(home, rel)));
  }
  for (const name of fs.readdirSync(opts.workspaceRoot).filter((entry) => entry.startsWith(".env"))) {
    args.push(...maskPathArgs(path.join(opts.workspaceRoot, name)));
  }
  args.push("--chdir", opts.cwd, "--", opts.command, ...opts.args);
  return args;
}

export function sandboxAvailable(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (findExecutable("srt", env)) return true;
  if (platform === "darwin") return fs.existsSync("/usr/bin/sandbox-exec");
  if (platform === "linux") return Boolean(findExecutable("bwrap", env));
  return false;
}

export function assertSandboxReady(mode: SandboxMode, platform?: NodeJS.Platform): void {
  if (mode === "danger-full-access") return;
  if (sandboxAvailable(platform)) return;
  throw new SandboxViolation(
    `OS sandbox unavailable on ${platform ?? process.platform}; choose danger-full-access explicitly to run unsandboxed`,
    "os-sandbox",
    "sandbox-required",
    "danger-full-access",
  );
}

function writeSessionSettings(opts: SandboxCommandOptions): string | undefined {
  if (!opts.agentDir) return undefined;
  const dir = path.join(opts.agentDir, "sandbox");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${opts.sessionId ?? "default"}.json`);
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      filesystem: {
        write: opts.mode === "workspace-write" ? [opts.workspaceRoot, opts.agentDir] : [opts.agentDir],
        denyRead: SENSITIVE_HOME_DIRS,
      },
      network: opts.allowNetwork ? "allow" : "deny",
    })}\n`,
    { mode: 0o600 },
  );
  return file;
}

export function sandboxCommand(opts: SandboxCommandOptions): SandboxedCommand {
  if (opts.mode === "danger-full-access") {
    return { command: opts.command, args: opts.args, sandboxed: false, backend: "none" };
  }
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec")) {
    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-p", buildSeatbeltProfile(opts), "--", opts.command, ...opts.args],
      sandboxed: true,
      backend: "seatbelt",
    };
  }
  if (platform === "linux") {
    const bwrap = findExecutable("bwrap", env);
    if (bwrap) {
      return { command: bwrap, args: buildBubblewrapArgs(opts), sandboxed: true, backend: "bubblewrap" };
    }
  }
  const srt = findExecutable("srt", env);
  const settings = srt ? writeSessionSettings(opts) : undefined;
  if (srt && settings) {
    return {
      command: srt,
      args: ["--settings", settings, "--", opts.command, ...opts.args],
      sandboxed: true,
      backend: "srt",
    };
  }
  throw new SandboxViolation(
    `OS sandbox unavailable on ${platform}; choose danger-full-access explicitly to run unsandboxed`,
    "os-sandbox",
    "sandbox-required",
    "danger-full-access",
  );
}
