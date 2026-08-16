import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "./index.js";
import { gitDiffTool, gitLogTool, gitShowTool, gitStatusTool } from "./git.js";
import type { ToolContext } from "./types.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "NinjaCode Test",
      GIT_AUTHOR_EMAIL: "test@ninjacode.invalid",
      GIT_COMMITTER_NAME: "NinjaCode Test",
      GIT_COMMITTER_EMAIL: "test@ninjacode.invalid",
    },
  });
}

async function createRepository(): Promise<{ root: string; ctx: ToolContext }> {
  const root = await fs.mkdtemp(path.join(process.cwd(), ".nc-git-tools-"));
  cleanup.push(root);
  await git(root, "init", "--quiet");
  await fs.writeFile(path.join(root, "tracked.txt"), "initial\n", "utf8");
  await git(root, "add", "tracked.txt");
  await git(root, "commit", "--quiet", "-m", "initial commit");
  return {
    root,
    ctx: {
      workspaceRoot: root,
      agentDir: path.join(root, ".ninjacode"),
      sandboxMode: "danger-full-access",
    },
  };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("structured Git tools", () => {
  it("registers every Git reader in all appropriate modes", () => {
    const registry = createDefaultToolRegistry();
    for (const mode of ["ask", "plan", "agent", "debug"] as const) {
      const tools = registry.forMode(mode);
      for (const name of ["git_status", "git_diff", "git_log", "git_show"]) {
        expect(tools.get(name)?.risk).toBe("read_only");
      }
    }
  });

  it("returns status and diff without shell parsing", async () => {
    const { root, ctx } = await createRepository();
    await fs.writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");

    const status = await gitStatusTool.execute(ctx, {});
    const diff = await gitDiffTool.execute(ctx, { path: "tracked.txt" });

    expect(status.output).toContain("tracked.txt");
    expect(diff.output).toContain("-initial");
    expect(diff.output).toContain("+changed");
    expect(diff.meta).toMatchObject({ command: "diff", repository: ".", truncated: false });
  });

  it("provides structured history and a single commit", async () => {
    const { ctx } = await createRepository();
    const log = await gitLogTool.execute(ctx, { max_count: 1 });
    const show = await gitShowTool.execute(ctx, { revision: "HEAD", context_lines: 0 });

    expect(log.output.split("\t")).toHaveLength(4);
    expect(log.output).toContain("initial commit");
    expect(show.output).toContain("commit ");
    expect(show.output).toContain("tracked.txt");
  });

  it("bounds large output and marks truncation in metadata", async () => {
    const { root, ctx } = await createRepository();
    await fs.writeFile(path.join(root, "tracked.txt"), `${"x".repeat(100_000)}\n`, "utf8");

    const result = await gitDiffTool.execute(ctx, {});

    expect(result.output.length).toBeLessThan(81_000);
    expect(result.output).toContain("[truncated ");
    expect(result.meta?.truncated).toBe(true);
  });

  it("rejects paths outside the selected repository", async () => {
    const { root, ctx } = await createRepository();
    const nested = path.join(root, "nested");
    await fs.mkdir(nested);
    await git(nested, "init", "--quiet");

    await expect(
      gitStatusTool.execute(ctx, { repository: "nested", path: "tracked.txt" }),
    ).rejects.toMatchObject({ code: "permission" });
    await expect(
      gitStatusTool.execute(ctx, { repository: "../outside" }),
    ).rejects.toMatchObject({ code: "permission" });
  });

  it("rejects option-like revisions before invoking Git", async () => {
    const { ctx } = await createRepository();
    await expect(gitShowTool.execute(ctx, { revision: "--help" })).rejects.toMatchObject({
      code: "invalid_args",
    });
  });

  it("treats pathspec magic characters as a literal file name", async () => {
    const { root, ctx } = await createRepository();
    await fs.writeFile(path.join(root, ":(top)"), "magic-before\n");
    await git(root, "--literal-pathspecs", "add", "--", ":(top)");
    await git(root, "commit", "--quiet", "-m", "add magic path");
    await fs.writeFile(path.join(root, ":(top)"), "magic-after\n");
    await fs.writeFile(path.join(root, "tracked.txt"), "unrelated\n");

    const result = await gitDiffTool.execute(ctx, { path: ":(top)" });

    expect(result.output).toContain("magic-after");
    expect(result.output).not.toContain("unrelated");
  });

  it("maps missing repositories and revisions to typed errors", async () => {
    const { ctx } = await createRepository();
    const plain = await fs.mkdtemp(path.join(process.cwd(), ".nc-git-plain-"));
    cleanup.push(plain);
    const plainContext: ToolContext = {
      workspaceRoot: plain,
      agentDir: path.join(plain, ".ninjacode"),
      sandboxMode: "danger-full-access",
    };

    await expect(
      gitStatusTool.execute(plainContext, {}),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      gitShowTool.execute(ctx, { revision: "definitely-missing" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
