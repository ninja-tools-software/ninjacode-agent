import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "@ninjacode/providers";
import { createSubAgent } from "./agent.js";
import { setAssetEnabled } from "./assetRegistry.js";
import {
  createCustomAgentHandoffTools,
  deleteCustomAgent,
  enabledCustomAgents,
  loadCustomAgents,
  writeCustomAgent,
} from "./customAgents.js";

const dirs: string[] = [];

async function tmpWorkspace(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nc-agents-")));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("loadCustomAgents", () => {
  it("loads .github/agents/*.agent.md with tools/handoffs/model", async () => {
    const root = await tmpWorkspace();
    const dir = path.join(root, ".github", "agents");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "reviewer.agent.md"),
      `---\ndescription: Reviews code for bugs\nmodel: claude-sonnet\ntools: [read_file, grep]\nhandoffs: [fixer]\n---\nYou are a meticulous code reviewer.`,
    );

    const agents = await loadCustomAgents(root);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "reviewer",
      description: "Reviews code for bugs",
      model: "claude-sonnet",
      tools: ["read_file", "grep"],
      handoffs: ["fixer"],
    });
    expect(agents[0]!.systemPrompt).toBe("You are a meticulous code reviewer.");
  });

  it("lets .claude/agents/*.md override .github/agents on name collision", async () => {
    const root = await tmpWorkspace();
    await fs.mkdir(path.join(root, ".github", "agents"), { recursive: true });
    await fs.writeFile(path.join(root, ".github", "agents", "helper.agent.md"), "GitHub version.");
    await fs.mkdir(path.join(root, ".claude", "agents"), { recursive: true });
    await fs.writeFile(path.join(root, ".claude", "agents", "helper.md"), "Claude version.");

    const agents = await loadCustomAgents(root);
    const helper = agents.find((a) => a.name === "helper");
    expect(helper?.systemPrompt).toBe("Claude version.");
  });

  it("returns an empty array when no agent directories exist", async () => {
    const root = await tmpWorkspace();
    expect(await loadCustomAgents(root)).toEqual([]);
  });

  it("loads .ninjacode/agents and reports the source directory", async () => {
    const root = await tmpWorkspace();
    await fs.mkdir(path.join(root, ".ninjacode", "agents"), { recursive: true });
    await fs.writeFile(path.join(root, ".ninjacode", "agents", "reviewer.md"), "Review carefully.");

    const agents = await loadCustomAgents(root);
    expect(agents[0]).toMatchObject({
      name: "reviewer",
      source: path.join(".ninjacode", "agents"),
      enabled: true,
    });
  });

  it("marks disabled agents instead of hiding them, and keeps them out of handoffs", async () => {
    const root = await tmpWorkspace();
    await fs.mkdir(path.join(root, ".ninjacode", "agents"), { recursive: true });
    await fs.writeFile(path.join(root, ".ninjacode", "agents", "reviewer.md"), "Review carefully.");
    await setAssetEnabled(root, "agent", "reviewer", false);

    const agents = await loadCustomAgents(root);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.enabled).toBe(false);
    expect(enabledCustomAgents(agents)).toEqual([]);
  });
});

describe("writeCustomAgent / deleteCustomAgent", () => {
  it("creates .ninjacode/agents/<slug>.md that loadCustomAgents reads back", async () => {
    const root = await tmpWorkspace();
    const file = await writeCustomAgent(root, {
      name: "Code Reviewer",
      description: "Reviews diffs",
      model: "claude-sonnet-4-5",
      tools: ["read_file", "grep"],
      systemPrompt: "You are a meticulous reviewer.",
    });
    expect(file).toBe(".ninjacode/agents/code-reviewer.md");

    const agents = await loadCustomAgents(root);
    expect(agents[0]).toMatchObject({
      name: "Code Reviewer",
      description: "Reviews diffs",
      model: "claude-sonnet-4-5",
      tools: ["read_file", "grep"],
      systemPrompt: "You are a meticulous reviewer.",
    });
  });

  it("requires a name and instructions", async () => {
    const root = await tmpWorkspace();
    await expect(writeCustomAgent(root, { name: " ", systemPrompt: "x" })).rejects.toThrow(
      /name is required/i,
    );
    await expect(writeCustomAgent(root, { name: "x", systemPrompt: " " })).rejects.toThrow(
      /instructions are required/i,
    );
  });

  it("deletes the agent file", async () => {
    const root = await tmpWorkspace();
    const file = await writeCustomAgent(root, { name: "tmp", systemPrompt: "x" });
    await deleteCustomAgent(root, file);
    expect(await loadCustomAgents(root)).toEqual([]);
  });

  it("refuses to write outside the workspace", async () => {
    const root = await tmpWorkspace();
    await expect(
      writeCustomAgent(root, { name: "escape", systemPrompt: "x", path: "../outside.md" }),
    ).rejects.toThrow(/escapes workspace/);
  });
});

describe("createCustomAgentHandoffTools", () => {
  it("builds one delegate tool per agent that runs a sub-agent with the persona's system prompt", async () => {
    const root = await tmpWorkspace();
    const agentDir = path.join(root, ".ninjacode");
    const [agent] = [
      {
        name: "researcher",
        description: "Finds relevant code",
        systemPrompt: "Investigate the codebase and summarize findings.",
        path: path.join(root, "researcher.agent.md"),
        source: ".github/agents",
        enabled: true,
      },
    ];

    const tools = createCustomAgentHandoffTools([agent!], {
      createAgent: createSubAgent,
      provider: new MockProvider(),
      workspaceRoot: root,
      agentDir,
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("agent_researcher");
    expect(tools[0]!.risk).toBe("read_only");

    const result = await tools[0]!.execute(
      { workspaceRoot: root, agentDir },
      { task: "Find the auth module" },
    );
    expect(typeof result.output).toBe("string");
    expect(result.meta).toMatchObject({ agent: "researcher" });
  });
});
