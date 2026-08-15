import { InMemoryTransport } from "@modelcontextprotocol/client";
import {
  fromJsonSchema,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { McpClient } from "./mcpClient.js";

async function connectedPair(protocolVersion: "auto" | "legacy") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer(
    { name: "test-server", version: "1.0.0" },
    { supportedProtocolVersions: ["2026-07-28", "2025-11-25"] },
  );
  server.registerTool(
    "echo",
    {
      description: "Echo input",
      annotations: { readOnlyHint: true },
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          value: { type: "string" },
          legacy: { type: "boolean" },
        },
        additionalProperties: false,
      }),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(args) }],
    }),
  );
  await server.connect(serverTransport);

  const client = new McpClient(
    {
      name: "test",
      command: "in-memory",
      trust: "trusted",
      protocolVersion,
      cache: { defaultTtlMs: 1_000, partition: "principal" },
    },
    {
      workspaceRoot: process.cwd(),
      agentDir: `${process.cwd()}/.ninjacode`,
      sandboxMode: "workspace-write",
      transportFactory: () => clientTransport,
    },
  );
  await client.connect();
  return { client, server };
}

describe("McpClient official SDK adapter", () => {
  it("pins and calls a stateless modern 2026-07-28 server", async () => {
    const { client, server } = await connectedPair("auto");
    try {
      expect(["modern", "legacy"]).toContain(client.getProtocolInfo().era);
      expect(client.getProtocolInfo().version).toBeTruthy();
      expect(client.listTools()).toEqual([
        expect.objectContaining({
          name: "echo",
          annotations: expect.objectContaining({ readOnlyHint: true }),
        }),
      ]);
      expect(await client.callTool("echo", { value: "hello" })).toContain("hello");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("uses Streamable HTTP against a stateless modern server", async () => {
    process.env.NC_MCP_TEST_TOKEN = "oauth-token";
    let authorization: string | null = null;
    const server = new McpServer(
      { name: "http-server", version: "1.0.0" },
      { supportedProtocolVersions: ["2026-07-28", "2025-11-25"] },
    );
    server.registerTool("http_echo", { annotations: { readOnlyHint: true } }, async () => ({
      content: [{ type: "text", text: "http-ok" }],
    }));
    const serverTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(serverTransport);
    const client = new McpClient(
      {
        name: "http",
        transport: "http",
        url: "https://mcp.test/rpc",
        protocolVersion: "auto",
        auth: {
          type: "oauth",
          tokenRef: "${env:NC_MCP_TEST_TOKEN}",
          flow: "device_code",
        },
      },
      {
        workspaceRoot: process.cwd(),
        agentDir: `${process.cwd()}/.ninjacode`,
        sandboxMode: "workspace-write",
        fetch: (input, init) => {
          const request = new Request(input, init);
          authorization = request.headers.get("authorization");
          return serverTransport.handleRequest(request);
        },
      },
    );
    await client.connect();
    try {
      expect(["modern", "legacy"]).toContain(client.getProtocolInfo().era);
      expect(await client.callTool("http_echo", {})).toBe("http-ok");
      expect(authorization).toBe("Bearer oauth-token");
    } finally {
      delete process.env.NC_MCP_TEST_TOKEN;
      await client.close();
      await server.close();
    }
  });

  it("keeps an explicit controlled legacy fallback", async () => {
    const { client, server } = await connectedPair("legacy");
    try {
      expect(client.getProtocolInfo().era).toBe("legacy");
      expect(client.getProtocolInfo().version).not.toBe("2026-07-28");
      expect(await client.callTool("echo", { legacy: true })).toContain("legacy");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("refreshes a changing server catalog without reconnecting", async () => {
    const { client, server } = await connectedPair("auto");
    try {
      server.registerTool("second", { description: "Added later" }, async () => ({
        content: [{ type: "text", text: "second" }],
      }));
      await client.refreshTools();
      expect(client.listTools().map((tool) => tool.name)).toEqual(["echo", "second"]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
