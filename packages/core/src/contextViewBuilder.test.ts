import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Message } from "@ninjacode/providers";
import { afterEach, describe, expect, it } from "vitest";
import { buildContextView } from "./contextViewBuilder.js";
import { isValidToolChain } from "./toolHistory.js";

const dirs: string[] = [];

async function scopedWorkspace(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nc-context-view-")));
  dirs.push(root);
  const rules = path.join(root, ".ninjacode", "rules");
  await fs.mkdir(rules, { recursive: true });
  await fs.writeFile(
    path.join(rules, "typescript.md"),
    `---\nglobs: ["**/*.ts"]\n---\nUse strict TypeScript.`,
  );
  await fs.writeFile(path.join(rules, "python.md"), `---\nglobs: ["**/*.py"]\n---\nUse Python types.`);
  await fs.writeFile(path.join(root, "AGENTS.md"), "Global instruction.");
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("buildContextView scoped rules", () => {
  it("injects only rules matching active or touched files", async () => {
    const root = await scopedWorkspace();
    const result = await buildContextView({
      history: [{ role: "user", content: "Update src/app.ts" }],
      workspaceRoot: root,
      activeFiles: ["src/app.ts"],
    });
    const content = result.messages.map((message) => message.content).join("\n");

    expect(content).toContain("Use strict TypeScript.");
    expect(content).not.toContain("Use Python types.");
    expect(content).not.toContain("Global instruction.");
  });

  it("uses an empty scoped-rule view when no active file set is available", async () => {
    const root = await scopedWorkspace();
    const result = await buildContextView({
      history: [{ role: "user", content: "Continue" }],
      workspaceRoot: root,
    });

    expect(result.changed).toBe(false);
    expect(result.messages.map((message) => message.content).join("\n")).not.toContain(
      "Use strict TypeScript.",
    );
  });

  it("is stable across turns and does not split tool-call chains", async () => {
    const root = await scopedWorkspace();
    const history: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "src/app.ts" } }],
      },
      { role: "tool", content: "file contents", name: "read_file", toolCallId: "call_1" },
      { role: "user", content: "Apply the change" },
    ];
    const first = await buildContextView({
      history,
      workspaceRoot: root,
      activeFiles: ["src/app.ts"],
    });
    const second = await buildContextView({
      history: first.messages,
      workspaceRoot: root,
      activeFiles: ["src/app.ts"],
    });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.messages).toEqual(first.messages);
    expect(isValidToolChain(second.messages)).toBe(true);
  });
});
