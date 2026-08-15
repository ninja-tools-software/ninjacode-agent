import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionArtifactPaths } from "@ninjacode/tools";
import { McpCatalog } from "./mcpCatalog.js";
import type { McpClient, McpToolDefinition } from "./mcpClient.js";

const dirs: string[] = [];

function fakeClient(opts: {
  name: string;
  trust?: "trusted" | "untrusted";
  tools: McpToolDefinition[];
  output?: string;
}): McpClient {
  return {
    getConfig: () => ({ name: opts.name, command: "fake", trust: opts.trust }),
    getProtocolInfo: () => ({ version: "2026-07-28", era: "modern" }),
    listTools: () => opts.tools,
    findTool: (name: string) => opts.tools.find((tool) => tool.name === name),
    callTool: vi.fn(async () => opts.output ?? "ok"),
  } as unknown as McpClient;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("McpCatalog", () => {
  it("exposes only three stable tools and loads remote schemas on demand", async () => {
    const tools: McpToolDefinition[] = [
      {
        name: "mutate",
        description: "Mutates external state",
        inputSchema: { type: "object", properties: { secretShape: { type: "string" } } },
      },
    ];
    const catalog = new McpCatalog([fakeClient({ name: "remote", tools })]);
    const stable = catalog.asNinjaTools();
    expect(stable.map((tool) => tool.name)).toEqual([
      "mcp_search_catalog",
      "mcp_describe_tool",
      "mcp_call_tool",
    ]);
    expect(JSON.stringify(stable.map((tool) => tool.inputSchema))).not.toContain("secretShape");

    const described = await stable[1]!.execute(
      { workspaceRoot: ".", agentDir: "." },
      { server: "remote", name: "mutate" },
    );
    expect(described.output).toContain("secretShape");
  });

  it("refreshes deterministically from the live catalog and distrusts missing annotations", () => {
    const tools: McpToolDefinition[] = [{ name: "zeta" }];
    const client = fakeClient({ name: "server", tools, trust: "untrusted" });
    const catalog = new McpCatalog([client]);
    expect(catalog.search("", undefined, 10)).toEqual([
      expect.objectContaining({ name: "zeta", risk: "destructive" }),
    ]);

    tools.splice(0, tools.length, { name: "alpha", annotations: { readOnlyHint: true } });
    expect(catalog.search("", undefined, 10)).toEqual([
      expect.objectContaining({ name: "alpha", risk: "destructive" }),
    ]);
  });

  it("archives oversized responses and returns bounded model output", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-mcp-catalog-"));
    dirs.push(workspaceRoot);
    const agentDir = path.join(workspaceRoot, ".ninjacode");
    const output = `start-${"x".repeat(80_000)}-end`;
    const catalog = new McpCatalog([
      fakeClient({
        name: "trusted",
        trust: "trusted",
        tools: [{ name: "read", annotations: { readOnlyHint: true } }],
        output,
      }),
    ]);
    const call = catalog.asNinjaTools()[2]!;
    expect(call.riskFor?.({ server: "trusted", name: "read" })).toBe("network");

    const result = await call.execute(
      { workspaceRoot, agentDir, sessionId: "session" },
      { server: "trusted", name: "read", arguments: {} },
    );
    const artifactId = (result.meta?.mcp as { artifactId?: string }).artifactId;
    expect(result.output.length).toBeLessThan(30_000);
    expect(artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await fs.readFile(sessionArtifactPaths(agentDir, "session", artifactId!).body, "utf8"),
    ).toBe(output);
  });
});
