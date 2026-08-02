import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { extractModelPatch } from "./workspace.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.rm(path.join(process.cwd(), ".tmp-swebench-test"), { recursive: true, force: true });
});

async function initRepo(): Promise<string> {
  const root = path.join(process.cwd(), ".tmp-swebench-test");
  const templateDir = path.join(root, "empty-template");
  await fs.mkdir(templateDir, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "patch-"));
  tempDirs.push(dir);
  await execFileAsync("git", ["-c", `init.templateDir=${templateDir}`, "init", "-q"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "bench@test.dev"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Bench"], { cwd: dir });
  await fs.writeFile(path.join(dir, "foo.txt"), "hello\n");
  await execFileAsync("git", ["add", "foo.txt"], { cwd: dir });
  await execFileAsync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

describe("extractModelPatch", () => {
  it("returns staged diff against HEAD", async () => {
    const dir = await initRepo();
    await fs.writeFile(path.join(dir, "foo.txt"), "hello world\n");
    const patch = await extractModelPatch(dir);
    expect(patch).toContain("foo.txt");
    expect(patch).toContain("hello world");
  });
});
