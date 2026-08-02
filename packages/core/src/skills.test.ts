import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "@ninjacode/providers";
import { createSubAgent } from "./agent.js";
import { setAssetEnabled } from "./assetRegistry.js";
import {
  createUseSkillTool,
  deleteSkill,
  discoverSkills,
  enabledSkills,
  loadSkillBody,
  writeSkill as saveSkill,
} from "./skills.js";

const dirs: string[] = [];

async function tmpWorkspace(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nc-skills-")));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

async function writeSkill(root: string, base: string, name: string, frontmatter: string, body: string) {
  const dir = path.join(root, base, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
}

describe("discoverSkills", () => {
  it("discovers metadata (name/description/context) without requiring the full body", async () => {
    const root = await tmpWorkspace();
    await writeSkill(
      root,
      ".agents/skills",
      "canvas",
      'name: canvas\ndescription: Build a live React canvas.\ncontext: inline',
      "Full instructions go here.",
    );

    const skills = await discoverSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "canvas", description: "Build a live React canvas.", context: "inline" });
  });

  it("defaults context to inline when not declared", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".claude/skills", "docs", "description: Write docs.", "body");
    const skills = await discoverSkills(root);
    expect(skills[0]!.context).toBe("inline");
  });

  it("recognizes context: fork", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".github/skills", "babysit", "description: Babysit a PR.\ncontext: fork", "body");
    const skills = await discoverSkills(root);
    expect(skills[0]!.context).toBe("fork");
  });

  it("returns an empty array when no skill directories exist", async () => {
    const root = await tmpWorkspace();
    expect(await discoverSkills(root)).toEqual([]);
  });

  it("discovers .ninjacode/skills and reports the source directory", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".ninjacode/skills", "audit", "description: Audit tokens.", "body");
    const skills = await discoverSkills(root);
    expect(skills[0]).toMatchObject({ name: "audit", source: ".ninjacode/skills", enabled: true });
  });

  it("lets .ninjacode/skills win over the legacy directories on name collisions", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".claude/skills", "audit", "name: audit\ndescription: legacy", "old");
    await writeSkill(root, ".ninjacode/skills", "audit", "name: audit\ndescription: current", "new");
    const skills = await discoverSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ description: "current", source: ".ninjacode/skills" });
  });

  it("marks disabled skills instead of hiding them, and keeps them out of use_skill", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".ninjacode/skills", "audit", "description: x", "body");
    await setAssetEnabled(root, "skill", "audit", false);

    const skills = await discoverSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.enabled).toBe(false);
    expect(enabledSkills(skills)).toEqual([]);
  });
});

describe("writeSkill / deleteSkill", () => {
  it("creates .ninjacode/skills/<slug>/SKILL.md that discovery reads back", async () => {
    const root = await tmpWorkspace();
    const file = await saveSkill(root, {
      name: "Release Checklist",
      description: "Use when cutting a release",
      context: "fork",
      allowedTools: ["read_file", "grep"],
      body: "## Steps\n1. Bump",
    });
    expect(file).toBe(".ninjacode/skills/release-checklist/SKILL.md");

    const [skill] = await discoverSkills(root);
    expect(skill).toMatchObject({
      name: "Release Checklist",
      description: "Use when cutting a release",
      context: "fork",
      allowedTools: ["read_file", "grep"],
    });
    expect(await loadSkillBody(skill!)).toBe("## Steps\n1. Bump");
  });

  it("overwrites an existing skill in place, wherever it lives", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".claude/skills", "audit", "name: audit\ndescription: before", "old");
    const [existing] = await discoverSkills(root);
    await saveSkill(root, {
      name: "audit",
      description: "after",
      context: "inline",
      body: "new",
      skillFile: existing!.skillFile,
    });

    const skills = await discoverSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ description: "after", source: ".claude/skills" });
  });

  it("removes the skill directory when SKILL.md was its only file", async () => {
    const root = await tmpWorkspace();
    const file = await saveSkill(root, {
      name: "audit",
      description: "x",
      context: "inline",
      body: "body",
    });
    await deleteSkill(root, file);
    expect(await discoverSkills(root)).toEqual([]);
    await expect(fs.stat(path.join(root, path.dirname(file)))).rejects.toThrow();
  });

  it("refuses to write outside the workspace", async () => {
    const root = await tmpWorkspace();
    await expect(
      saveSkill(root, {
        name: "escape",
        description: "x",
        context: "inline",
        body: "body",
        skillFile: "../outside/SKILL.md",
      }),
    ).rejects.toThrow(/escapes workspace/);
  });
});

describe("loadSkillBody", () => {
  it("reads the full SKILL.md body on demand (progressive loading level 2)", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".agents/skills", "canvas", "description: x", "Detailed step-by-step instructions.");
    const [skill] = await discoverSkills(root);
    const body = await loadSkillBody(skill!);
    expect(body).toBe("Detailed step-by-step instructions.");
  });
});

describe("createUseSkillTool", () => {
  it("returns the skill body inline for context:inline skills", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".agents/skills", "canvas", "description: x\ncontext: inline", "Do the canvas thing.");
    const skills = await discoverSkills(root);
    const tool = createUseSkillTool(skills, {
      createAgent: createSubAgent,
      provider: new MockProvider(),
      workspaceRoot: root,
      agentDir: path.join(root, ".ninjacode"),
    });

    const result = await tool.execute({ workspaceRoot: root, agentDir: path.join(root, ".ninjacode") }, {
      skill: "canvas",
    });
    expect(result.output).toContain("Do the canvas thing.");
    expect(result.meta).toMatchObject({ found: true, context: "inline" });
  });

  it("delegates to a sub-agent for context:fork skills", async () => {
    const root = await tmpWorkspace();
    await writeSkill(root, ".agents/skills", "babysit", "description: x\ncontext: fork", "Keep the PR green.");
    const skills = await discoverSkills(root);
    const tool = createUseSkillTool(skills, {
      createAgent: createSubAgent,
      provider: new MockProvider(),
      workspaceRoot: root,
      agentDir: path.join(root, ".ninjacode"),
    });

    const result = await tool.execute({ workspaceRoot: root, agentDir: path.join(root, ".ninjacode") }, {
      skill: "babysit",
      task: "Fix the failing check",
    });
    expect(result.meta).toMatchObject({ found: true, context: "fork" });
  });

  it("reports unknown skills without throwing", async () => {
    const tool = createUseSkillTool([], {
      createAgent: createSubAgent,
      provider: new MockProvider(),
      workspaceRoot: "/tmp",
      agentDir: "/tmp/.ninjacode",
    });
    const result = await tool.execute({ workspaceRoot: "/tmp", agentDir: "/tmp/.ninjacode" }, {
      skill: "nope",
    });
    expect(result.output).toContain("Unknown skill");
    expect(result.meta).toMatchObject({ found: false });
  });
});
