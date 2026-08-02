import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandPromptArguments, loadPrompts } from "./prompts.js";

const dirs: string[] = [];

async function tmpWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-prompts-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("loadPrompts", () => {
  it("loads .github/prompts/*.prompt.md with frontmatter", async () => {
    const root = await tmpWorkspace();
    const dir = path.join(root, ".github", "prompts");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "review.prompt.md"),
      `---\ndescription: Review recent changes\nargument-hint: "[scope]"\n---\nReview: $ARGUMENTS`,
    );

    const prompts = await loadPrompts(root);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      name: "review",
      description: "Review recent changes",
      argumentHint: "[scope]",
      scope: "project",
    });
    expect(prompts[0]!.body).toBe("Review: $ARGUMENTS");
  });

  it("loads .claude/commands/*.md as project prompts", async () => {
    const root = await tmpWorkspace();
    const dir = path.join(root, ".claude", "commands");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "tests.md"), "Write tests for $ARGUMENTS");

    const prompts = await loadPrompts(root);
    expect(prompts.map((p) => p.name)).toContain("tests");
  });

  it("skips files with empty bodies", async () => {
    const root = await tmpWorkspace();
    const dir = path.join(root, ".ninjacode", "prompts");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "empty.md"), "---\ndescription: nothing here\n---\n   ");

    const prompts = await loadPrompts(root);
    expect(prompts).toHaveLength(0);
  });

  it("returns an empty array when no prompt directories exist", async () => {
    const root = await tmpWorkspace();
    expect(await loadPrompts(root)).toEqual([]);
  });
});

describe("expandPromptArguments", () => {
  it("substitutes $ARGUMENTS when present", () => {
    expect(expandPromptArguments("Do: $ARGUMENTS", "the thing")).toBe("Do: the thing");
  });

  it("appends arguments when no placeholder is present", () => {
    expect(expandPromptArguments("Do the thing", "extra context")).toBe(
      "Do the thing\n\nextra context",
    );
  });

  it("returns the body unchanged when no arguments are given", () => {
    expect(expandPromptArguments("Do: $ARGUMENTS", "")).toBe("Do: $ARGUMENTS");
  });
});
