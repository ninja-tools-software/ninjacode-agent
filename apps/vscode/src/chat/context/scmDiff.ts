import { spawn } from "node:child_process";
import type { ContextProvider } from "./types.js";

const MAX_DIFF_CHARS = 16_000;

/** Sentinel target for "everything uncommitted", as opposed to a single file's diff. */
export const WORKING_TREE_TARGET = "__scm_diff__";

/** `git diff` of the working tree, optionally scoped to one path. */
function gitDiff(workspaceRoot: string, relPath?: string): Promise<string> {
  return new Promise((resolve) => {
    const args = ["diff", "--no-color", ...(relPath ? ["--", relPath] : [])];
    const child = spawn("git", args, { cwd: workspaceRoot });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("error", () => resolve("[git not available]"));
    child.on("close", () => {
      const diff = out.trim();
      if (diff) return resolve(diff.slice(0, MAX_DIFF_CHARS));
      resolve(err.trim() ? `[git diff error: ${err.trim()}]` : "(no uncommitted changes)");
    });
  });
}

export const scmDiffProvider: ContextProvider = {
  kind: "scm_diff",
  async suggest() {
    return [
      { id: WORKING_TREE_TARGET, label: "Uncommitted changes", detail: "git diff (working tree)" },
    ];
  },
  async resolve(target, env) {
    const scoped = target && target !== WORKING_TREE_TARGET ? target : undefined;
    const diff = await gitDiff(env.root, scoped);
    return {
      text: scoped ? `Diff for ${scoped}:\n\`\`\`diff\n${diff}\n\`\`\`` : `Uncommitted changes:\n\`\`\`diff\n${diff}\n\`\`\``,
      label: scoped ? `diff ${scoped}` : "Uncommitted changes",
    };
  },
};
