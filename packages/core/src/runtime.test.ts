import { describe, expect, it } from "vitest";
import { MockProvider } from "@ninjacode/providers";
import { buildAgentRuntime } from "./runtime.js";

describe("buildAgentRuntime", () => {
  it("creates tools, permissions, and agent with defaults", async () => {
    const provider = new MockProvider([{ text: "ok" }]);
    const runtime = await buildAgentRuntime({
      workspaceRoot: "/tmp/ws",
      provider,
    });

    expect(runtime.tools.names().length).toBeGreaterThan(0);
    expect(runtime.agentOptions.provider).toBe(provider);
    expect(runtime.agentOptions.workspaceRoot).toBe("/tmp/ws");

    const agent = runtime.createAgent();
    expect(agent).toBeDefined();
  });

  it("allowAllTools pre-approves every tool except irreversible calls", async () => {
    const provider = new MockProvider([{ text: "ok" }]);
    const runtime = await buildAgentRuntime({
      workspaceRoot: "/tmp/ws",
      provider,
      allowAllTools: true,
      configureTools: (tools) => {
        tools.register({
          name: "extra_tool",
          description: "test",
          risk: "read_only",
          inputSchema: { type: "object", properties: {} },
          target: () => "",
          execute: async () => ({ output: "done" }),
        });
      },
    });

    for (const name of runtime.tools.names()) {
      const tool = runtime.tools.get(name)!;
      const decision = runtime.permissions.evaluate(tool, "any-target");
      expect(decision.allowed).toBe(true);
      // Destructive tools still reach the approval handler — the host decides.
      expect(decision.needsApproval).toBe(tool.risk === "destructive");
    }
  });

  it("applies grants", async () => {
    const provider = new MockProvider([{ text: "ok" }]);
    const runtime = await buildAgentRuntime({
      workspaceRoot: "/tmp/ws",
      provider,
      grants: [{ tool: "read_file", target: "/foo" }],
    });

    const readFile = runtime.tools.get("read_file")!;
    expect(runtime.permissions.evaluate(readFile, "/foo").allowed).toBe(true);
  });

  it("excludes network tools when includeNetwork is false", async () => {
    const provider = new MockProvider([{ text: "ok" }]);
    const runtime = await buildAgentRuntime({
      workspaceRoot: "/tmp/ws",
      provider,
      includeNetwork: false,
    });

    expect(runtime.tools.get("fetch_url")).toBeUndefined();
    expect(runtime.tools.get("web_search")).toBeUndefined();
  });
});

describe("isParallelizableBatch", () => {
  it("allows mixing reads with todo_write and distinct-file edits", async () => {
    const { createDefaultToolRegistry } = await import("@ninjacode/tools");
    const { isParallelizableBatch } = await import("./toolPipelineHelpers.js");
    const tools = createDefaultToolRegistry();

    expect(
      isParallelizableBatch(tools, [
        { id: "1", name: "read_file", arguments: { path: "a.ts" } },
        { id: "2", name: "todo_write", arguments: { todos: [] } },
        { id: "3", name: "grep", arguments: { pattern: "x" } },
      ]),
    ).toBe(true);

    expect(
      isParallelizableBatch(tools, [
        { id: "1", name: "edit_file", arguments: { path: "a.ts", old_string: "a", new_string: "b" } },
        { id: "2", name: "edit_file", arguments: { path: "b.ts", old_string: "a", new_string: "b" } },
      ]),
    ).toBe(true);

    expect(
      isParallelizableBatch(tools, [
        { id: "1", name: "edit_file", arguments: { path: "a.ts", old_string: "a", new_string: "b" } },
        { id: "2", name: "edit_file", arguments: { path: "a.ts", old_string: "c", new_string: "d" } },
      ]),
    ).toBe(false);

    expect(
      isParallelizableBatch(tools, [
        { id: "1", name: "read_file", arguments: { path: "a.ts" } },
        { id: "2", name: "run_shell", arguments: { command: "ls" } },
      ]),
    ).toBe(false);
  });
});
