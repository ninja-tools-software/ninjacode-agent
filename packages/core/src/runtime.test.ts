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

  it("allowAllTools pre-approves every registered tool", async () => {
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

    const names = runtime.tools.names();
    for (const name of names) {
      const tool = runtime.tools.get(name)!;
      const decision = runtime.permissions.evaluate(tool, "any-target");
      expect(decision.allowed).toBe(true);
      expect(decision.needsApproval).toBe(false);
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
