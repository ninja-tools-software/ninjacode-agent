import type { RiskClass, Tool, ToolContext, ToolResult } from "@ninjacode/tools";
import { ToolError } from "@ninjacode/tools";
import type { McpClient, McpToolDefinition } from "./mcpClient.js";
import { mcpToolRisk } from "./mcpPolicy.js";
import { SessionArtifactStore } from "./sessionArtifacts.js";

const RESPONSE_INLINE_CHARS = 64_000;
const RESPONSE_PREVIEW_CHARS = 24_000;

export class McpCatalog {
  constructor(private readonly clients: McpClient[]) {}

  asNinjaTools(): Tool[] {
    return [this.searchTool(), this.describeTool(), this.callTool()];
  }

  search(query: string, server?: string, limit = 20) {
    const needle = query.trim().toLowerCase();
    return this.entries()
      .filter((entry) => !server || entry.server === server)
      .filter((entry) => {
        if (!needle) return true;
        return `${entry.server} ${entry.tool.name} ${entry.tool.description ?? ""}`
          .toLowerCase()
          .includes(needle);
      })
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((entry) => ({
        server: entry.server,
        name: entry.tool.name,
        description: entry.tool.description,
        risk: mcpToolRisk(entry.client.getConfig(), entry.tool.annotations),
      }));
  }

  describe(server: string, name: string) {
    const entry = this.entry(server, name);
    return {
      server,
      name,
      description: entry.tool.description,
      inputSchema: entry.tool.inputSchema ?? { type: "object", properties: {} },
      annotations: entry.tool.annotations,
      risk: mcpToolRisk(entry.client.getConfig(), entry.tool.annotations),
      protocol: entry.client.getProtocolInfo(),
      trust: entry.client.getConfig().trust ?? "untrusted",
      provenance: entry.client.getConfig().provenance ?? "workspace",
    };
  }

  private entries(): Array<{ server: string; tool: McpToolDefinition; client: McpClient }> {
    return this.clients
      .flatMap((client) =>
        client.listTools().map((tool) => ({
          server: client.getConfig().name,
          tool,
          client,
        })),
      )
      .sort((left, right) =>
        `${left.server}\0${left.tool.name}`.localeCompare(`${right.server}\0${right.tool.name}`),
      );
  }

  private entry(server: string, name: string): { tool: McpToolDefinition; client: McpClient } {
    const client = this.clients.find((candidate) => candidate.getConfig().name === server);
    const tool = client?.findTool(name);
    if (!client || !tool) throw new ToolError(`Unknown MCP tool: ${server}/${name}`, "not_found");
    return { client, tool };
  }

  private searchTool(): Tool {
    return {
      name: "mcp_search_catalog",
      description:
        "Search connected MCP servers by server, tool name, or description. Returns compact metadata without schemas.",
      risk: "read_only",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text; empty lists all tools." },
          server: { type: "string", description: "Optional exact server name." },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        required: ["query"],
      },
      target: (args) => `mcp-catalog:${String(args.server ?? "*")}:${String(args.query ?? "")}`,
      execute: async (_ctx, args) => ({
        output: JSON.stringify(
          this.search(
            typeof args.query === "string" ? args.query : "",
            typeof args.server === "string" ? args.server : undefined,
            typeof args.limit === "number" ? args.limit : 20,
          ),
          null,
          2,
        ),
      }),
    };
  }

  private describeTool(): Tool {
    return {
      name: "mcp_describe_tool",
      description: "Load the full input schema and security metadata for one MCP tool.",
      risk: "read_only",
      inputSchema: {
        type: "object",
        properties: {
          server: { type: "string" },
          name: { type: "string" },
        },
        required: ["server", "name"],
      },
      target: (args) => `mcp-schema:${String(args.server)}:${String(args.name)}`,
      execute: async (_ctx, args) => ({
        output: JSON.stringify(this.describe(requiredString(args, "server"), requiredString(args, "name")), null, 2),
      }),
    };
  }

  private callTool(): Tool {
    return {
      name: "mcp_call_tool",
      description:
        "Call one MCP tool after discovering and describing it. Mutating or untrusted calls require per-call approval.",
      risk: "network",
      riskFor: (args) => this.riskFor(args),
      grantPolicy: () => "never",
      inputSchema: {
        type: "object",
        properties: {
          server: { type: "string" },
          name: { type: "string" },
          arguments: { type: "object", additionalProperties: true },
        },
        required: ["server", "name", "arguments"],
      },
      target: (args) => `mcp:${String(args.server)}:${String(args.name)}`,
      execute: (ctx, args) => this.executeCall(ctx, args),
    };
  }

  private riskFor(args: Record<string, unknown>): RiskClass {
    try {
      const { client, tool } = this.entry(requiredString(args, "server"), requiredString(args, "name"));
      return mcpToolRisk(client.getConfig(), tool.annotations);
    } catch {
      return "destructive";
    }
  }

  private async executeCall(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const server = requiredString(args, "server");
    const name = requiredString(args, "name");
    const callArgs = objectArgument(args.arguments);
    const { client, tool } = this.entry(server, name);
    const output = await client.callTool(name, callArgs, ctx.signal);
    const risk = mcpToolRisk(client.getConfig(), tool.annotations);
    const meta: Record<string, unknown> = {
      mcp: {
        server,
        tool: name,
        protocol: client.getProtocolInfo(),
        annotations: tool.annotations ?? null,
        risk,
        responseChars: output.length,
      },
    };
    if (output.length <= RESPONSE_INLINE_CHARS || !ctx.sessionId) return { output, meta };

    const artifact = await new SessionArtifactStore(ctx.agentDir, ctx.sessionId).putText(output, {
      kind: "mcp_output",
      mimeType: "text/plain; charset=utf-8",
    });
    (meta.mcp as Record<string, unknown>).artifactId = artifact.id;
    return {
      output:
        `${output.slice(0, RESPONSE_PREVIEW_CHARS)}\n\n` +
        `[MCP response truncated; ${output.length} chars archived as artifact ${artifact.id}. ` +
        "Use read_session_artifact to recover it.]",
      meta,
    };
  }
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolError(`${key} must be a non-empty string`, "invalid_args");
  }
  return value;
}

function objectArgument(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolError("arguments must be an object", "invalid_args");
  }
  return value as Record<string, unknown>;
}
