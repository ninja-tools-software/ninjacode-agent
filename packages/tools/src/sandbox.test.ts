import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSandboxReady,
  buildBubblewrapArgs,
  buildExecutionEnv,
  buildSeatbeltProfile,
  sandboxAvailable,
  sandboxCommand,
  SandboxViolation,
  type SandboxCommandOptions,
} from "./sandbox.js";
import { SandboxExecutor } from "./sandboxExecutor.js";
import { shellTool } from "./shell.js";

function options(root: string): SandboxCommandOptions {
  return {
    command: "/bin/sh",
    args: ["-c", "echo ok"],
    cwd: root,
    workspaceRoot: root,
    agentDir: path.join(root, ".ninjacode"),
    mode: "workspace-write",
    env: { PATH: process.env.PATH, HOME: os.homedir() },
  };
}

function executableOnPath(name: string): boolean {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((dir) => dir.length > 0 && fs.existsSync(path.join(dir, name)));
}

describe("sandbox boundary", () => {
  it("builds a minimal environment and excludes inherited credentials", () => {
    const env = buildExecutionEnv({
      PATH: "/usr/bin",
      LANG: "C",
      ANTHROPIC_API_KEY: "secret",
      GITHUB_TOKEN: "secret",
      DATABASE_PASSWORD: "secret",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.LANG).toBe("C");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DATABASE_PASSWORD).toBeUndefined();
  });

  it("allows only explicitly supplied secret variables", () => {
    const env = buildExecutionEnv({ PATH: "/usr/bin", API_TOKEN: "inherited" }, {
      API_TOKEN: "explicit",
    });
    expect(env.API_TOKEN).toBe("explicit");
  });

  it("denies network and sensitive paths in the Seatbelt profile", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-seatbelt-"));
    const profile = buildSeatbeltProfile(options(root));
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain(`${root}/.env`);
    expect(profile).toContain(`${os.homedir()}/.ssh`);
    expect(profile).toContain(`(allow file-write* (subpath "${root}"))`);
  });

  it("builds a Linux namespace with a read-only host and private network", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-bwrap-"));
    const args = buildBubblewrapArgs(options(root));
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--bind");
    expect(args.slice(-2)).toEqual(["-c", "echo ok"]);
  });

  it("fails closed when the OS backend is unavailable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-sandbox-"));
    expect(() => sandboxCommand({ ...options(root), platform: "win32" })).toThrow(SandboxViolation);
    expect(() => assertSandboxReady("workspace-write", "win32")).toThrow(/danger-full-access/);
  });

  it("does not inherit HOME or package-manager credentials", () => {
    const env = buildExecutionEnv({
      PATH: "/usr/bin",
      HOME: "/Users/secret",
      PNPM_HOME: "/secret/pnpm",
      GIT_ASKPASS: "leak",
    });
    expect(env.HOME).toBe("/tmp");
    expect(env.PNPM_HOME).toBeUndefined();
    expect(env.GIT_ASKPASS).toBeUndefined();
  });

  it("exposes a per-session executor API around the same boundary", () => {
    if (!sandboxAvailable()) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-executor-"));
    const executor = new SandboxExecutor({
      workspaceRoot: root,
      agentDir: path.join(root, ".ninjacode"),
      mode: "workspace-write",
      sessionId: "sess-1",
    });
    const wrapped = executor.wrap("/bin/echo", ["ok"]);
    expect(wrapped.sandboxed).toBe(true);
    expect(["seatbelt", "bubblewrap", "srt"]).toContain(wrapped.backend);
  });

  it("permits an explicit danger-full-access escape hatch", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-sandbox-"));
    expect(sandboxCommand({ ...options(root), mode: "danger-full-access" })).toMatchObject({
      command: "/bin/sh",
      sandboxed: false,
      backend: "none",
    });
  });

  it.runIf(process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec"))(
    "blocks workspace secret reads in the real macOS sandbox",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-real-sandbox-"));
      fs.mkdirSync(path.join(root, ".ninjacode"));
      fs.writeFileSync(path.join(root, ".env"), "TOP_SECRET_SENTINEL");
      const outside = path.join(os.homedir(), `.ninjacode-sandbox-test-${process.pid}`);
      const result = await shellTool.execute(
        { workspaceRoot: root, agentDir: path.join(root, ".ninjacode") },
        { command: `cat .env; printf pwn > '${outside}'` },
      );
      expect(result.meta?.exitCode).not.toBe(0);
      expect(result.output).not.toContain("TOP_SECRET_SENTINEL");
      expect(fs.existsSync(outside)).toBe(false);
    },
  );

  it.runIf(process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec"))(
    "blocks ~/.ssh reads, outside writes and network in the real macOS sandbox",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-real-sandbox-"));
      fs.mkdirSync(path.join(root, ".ninjacode"));
      const sshProbe = path.join(os.homedir(), ".ssh");
      const result = await shellTool.execute(
        { workspaceRoot: root, agentDir: path.join(root, ".ninjacode") },
        { command: `cat '${sshProbe}/id_rsa' 2>/dev/null; curl -s --max-time 2 https://example.com; printf pwn > /tmp/nc-sandbox-net-${process.pid}` },
      );
      expect(result.output).not.toMatch(/BEGIN (OPENSSH |RSA )?PRIVATE KEY/);
      expect(result.output).not.toMatch(/<html/i);
    },
  );

  it.runIf(process.platform === "linux" && executableOnPath("bwrap"))(
    "blocks ~/.ssh reads and network in the real Linux sandbox",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-real-sandbox-"));
      fs.mkdirSync(path.join(root, ".ninjacode"));
      const result = await shellTool.execute(
        { workspaceRoot: root, agentDir: path.join(root, ".ninjacode") },
        { command: "cat ~/.ssh/id_rsa 2>/dev/null; curl -s --max-time 2 https://example.com" },
      );
      expect(result.meta?.exitCode).not.toBe(0);
      expect(result.output).not.toMatch(/BEGIN (OPENSSH |RSA )?PRIVATE KEY/);
      expect(result.output).not.toMatch(/<html/i);
    },
  );

  it.runIf(process.platform === "linux" && executableOnPath("bwrap"))(
    "blocks workspace secret reads in the real Linux sandbox",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-real-sandbox-"));
      fs.mkdirSync(path.join(root, ".ninjacode"));
      fs.writeFileSync(path.join(root, ".env"), "TOP_SECRET_SENTINEL");
      const result = await shellTool.execute(
        { workspaceRoot: root, agentDir: path.join(root, ".ninjacode") },
        { command: "cat .env" },
      );
      expect(result.meta?.exitCode).not.toBe(0);
      expect(result.output).not.toContain("TOP_SECRET_SENTINEL");
    },
  );
});
