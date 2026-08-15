import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setAssetEnabled } from "./assetRegistry.js";
import {
  buildSystemPrompt,
  deleteRule,
  discoverRules,
  loadProjectRules,
  readRuleBody,
  writeRule,
} from "./rules.js";

const dirs: string[] = [];

async function tmpWorkspace(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nc-rules-")));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("discoverRules", () => {
  it("loads a root AGENTS.md and reports it as included", async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, "AGENTS.md"), "Root instructions.");

    const result = await discoverRules(root);
    expect(result.text).toContain("Root instructions.");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "AGENTS.md", path: "AGENTS.md", included: true }),
    );
  });

  it("discovers nested AGENTS.md files under subdirectories", async () => {
    const root = await tmpWorkspace();
    await fs.mkdir(path.join(root, "packages", "api"), { recursive: true });
    await fs.writeFile(path.join(root, "packages", "api", "AGENTS.md"), "API-specific rules.");

    const result = await discoverRules(root);
    expect(result.text).toContain("API-specific rules.");
    const diag = result.diagnostics.find((d) => d.path === path.join("packages", "api", "AGENTS.md"));
    expect(diag?.included).toBe(true);
  });

  it("skips node_modules and .git when walking for nested rules", async () => {
    const root = await tmpWorkspace();
    await fs.mkdir(path.join(root, "node_modules", "some-pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "some-pkg", "AGENTS.md"), "Should not load.");

    const result = await discoverRules(root);
    expect(result.text).not.toContain("Should not load.");
  });

  it("loads CLAUDE.md alongside AGENTS.md", async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, "CLAUDE.md"), "Claude-specific instructions.");

    const result = await discoverRules(root);
    expect(result.text).toContain("Claude-specific instructions.");
  });

  it("parses .cursor/rules/*.mdc frontmatter globs and includes the scope in diagnostics", async () => {
    const root = await tmpWorkspace();
    const rulesDir = path.join(root, ".cursor", "rules");
    try {
      await fs.mkdir(rulesDir, { recursive: true });
    } catch (e) {
      // Some sandboxes block creating a literal `.cursor` directory.
      if ((e as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }
      throw e;
    }
    await fs.writeFile(
      path.join(rulesDir, "typescript.mdc"),
      `---\ndescription: TS conventions\nglobs: ["**/*.ts", "**/*.tsx"]\nalwaysApply: false\n---\nUse strict types.`,
    );

    const result = await discoverRules(root);
    expect(result.text).toContain("Use strict types.");
    const diag = result.diagnostics.find((d) => d.kind === "cursor-rule");
    expect(diag?.included).toBe(true);
    expect(diag?.globs).toEqual(["**/*.ts", "**/*.tsx"]);
  });

  it("loads .github/copilot-instructions.md", async () => {
    const root = await tmpWorkspace();
    await fs.mkdir(path.join(root, ".github"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".github", "copilot-instructions.md"),
      "Follow the house style.",
    );

    const result = await discoverRules(root);
    expect(result.text).toContain("Follow the house style.");
  });

  it("parses .github/instructions/*.instructions.md with an applyTo glob scope", async () => {
    const root = await tmpWorkspace();
    const dir = path.join(root, ".github", "instructions");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "python.instructions.md"),
      `---\napplyTo: "**/*.py"\n---\nUse type hints everywhere.`,
    );

    const result = await discoverRules(root);
    expect(result.text).toContain("Use type hints everywhere.");
    const diag = result.diagnostics.find((d) => d.kind === "copilot-instructions-scoped");
    expect(diag?.globs).toEqual(["**/*.py"]);
  });

  it("loads legacy .ninjacode/rules/*.md files", async () => {
    const root = await tmpWorkspace();
    const dir = path.join(root, ".ninjacode", "rules");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "style.md"), "Legacy rule content.");

    const result = await discoverRules(root);
    expect(result.text).toContain("Legacy rule content.");
  });

  it("reports empty files as not included with a reason", async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, "AGENTS.md"), "   ");

    const result = await discoverRules(root);
    const diag = result.diagnostics.find((d) => d.kind === "AGENTS.md");
    expect(diag?.included).toBe(false);
    expect(diag?.reason).toBeTruthy();
  });

  it("returns empty diagnostics for a workspace with no rule files", async () => {
    const root = await tmpWorkspace();
    const result = await discoverRules(root);
    expect(result.text).toBe("");
    expect(result.diagnostics).toEqual([]);
  });

  it("drops a disabled rule from the prompt but keeps it in the diagnostics", async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, "AGENTS.md"), "Root instructions.");
    await fs.writeFile(path.join(root, "CLAUDE.md"), "Other instructions.");
    await setAssetEnabled(root, "rule", "AGENTS.md", false);

    const result = await discoverRules(root);
    expect(result.text).not.toContain("Root instructions.");
    expect(result.text).toContain("Other instructions.");
    expect(result.diagnostics).toContainEqual({
      kind: "AGENTS.md",
      path: "AGENTS.md",
      included: false,
      reason: "disabled in settings",
    });
  });
});

describe("writeRule / readRuleBody / deleteRule", () => {
  it("creates .ninjacode/rules/<slug>.md with frontmatter metadata", async () => {
    const root = await tmpWorkspace();
    const file = await writeRule(root, {
      name: "TypeScript Conventions",
      description: "How we write TypeScript",
      globs: ["src/**/*.ts"],
      body: "- Prefer named exports",
    });
    expect(file).toBe(".ninjacode/rules/typescript-conventions.md");

    const result = await discoverRules(root);
    expect(result.text).toContain("- Prefer named exports");
    const diag = result.diagnostics.find((d) => d.kind === "ninjacode-rules");
    expect(diag?.globs).toEqual(["src/**/*.ts"]);

    const loaded = await readRuleBody(root, file);
    expect(loaded).toMatchObject({
      body: "- Prefer named exports",
      description: "How we write TypeScript",
      globs: ["src/**/*.ts"],
    });
  });

  it("writes plain instruction files without inventing frontmatter", async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, "AGENTS.md"), "old");
    await writeRule(root, {
      name: "AGENTS.md",
      description: "ignored here",
      body: "New root instructions.",
      path: "AGENTS.md",
    });
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("New root instructions.\n");
  });

  it("preserves the metadata of foreign conventions it does not own", async () => {
    const root = await tmpWorkspace();
    const rel = path.join(".github", "instructions", "python.instructions.md");
    await fs.mkdir(path.join(root, ".github", "instructions"), { recursive: true });
    await fs.writeFile(
      path.join(root, rel),
      `---\napplyTo: "**/*.py"\n---\nUse type hints.`,
    );

    await writeRule(root, { name: "python", body: "Use type hints everywhere.", path: rel });

    const raw = await fs.readFile(path.join(root, rel), "utf8");
    expect(raw).toBe(`---\napplyTo: "**/*.py"\n---\nUse type hints everywhere.\n`);
    const diag = (await discoverRules(root)).diagnostics.find(
      (d) => d.kind === "copilot-instructions-scoped",
    );
    expect(diag?.globs).toEqual(["**/*.py"]);
  });

  it("requires a name and content, and stays inside the workspace", async () => {
    const root = await tmpWorkspace();
    await expect(writeRule(root, { name: "", body: "x" })).rejects.toThrow(/name is required/i);
    await expect(writeRule(root, { name: "x", body: " " })).rejects.toThrow(/content is required/i);
    await expect(
      writeRule(root, { name: "x", body: "y", path: "../outside.md" }),
    ).rejects.toThrow(/escapes workspace/);
  });

  it("deletes a rule file", async () => {
    const root = await tmpWorkspace();
    const file = await writeRule(root, { name: "tmp", body: "content" });
    await deleteRule(root, file);
    expect((await discoverRules(root)).diagnostics).toEqual([]);
  });
});

describe("buildSystemPrompt", () => {
  it("asks PLAN mode to write the plan and todo checklist in the same turn", () => {
    const prompt = buildSystemPrompt({ mode: "plan", workspaceRoot: "/repo" });
    expect(prompt).toContain("PLAN mode");
    expect(prompt).toContain("todo_write");
    expect(prompt).toContain("SAME turn");
    expect(prompt).toContain("8 exploration");
    expect(prompt).toContain("delegate");
    expect(prompt).toContain("harness stops the run");
    expect(prompt).toContain("Do not mark todos in_progress");
    expect(prompt).toContain("update the plan by calling write_plan again");
    expect(prompt).toContain("Execute plan");
  });

  it("tells AGENT mode to reuse an existing plan checklist and batch todos with work", () => {
    const prompt = buildSystemPrompt({ mode: "agent", workspaceRoot: "/repo" });
    expect(prompt).toContain("todo_write");
    expect(prompt).toContain("in_progress");
    expect(prompt.toLowerCase()).toContain("reuse");
    expect(prompt).toContain("SAME turn as the work");
    expect(prompt).not.toContain("Prefer small precise edits");
  });

  it("forbids re-reading after a successful edit and asks for parallel reads", () => {
    const prompt = buildSystemPrompt({ mode: "agent", workspaceRoot: "/repo" });
    expect(prompt).toContain("do NOT read_file the result");
    expect(prompt).toContain("read_lints");
    expect(prompt).toContain("in parallel");
    expect(prompt).toContain("Do not pass small limit values");
    expect(prompt).toContain("Prefer the grep tool");
  });
});

describe("loadProjectRules", () => {
  it("returns the same text as discoverRules().text", async () => {
    const root = await tmpWorkspace();
    await fs.writeFile(path.join(root, "AGENTS.md"), "Hello.");
    const text = await loadProjectRules(root);
    expect(text).toContain("Hello.");
  });
});
