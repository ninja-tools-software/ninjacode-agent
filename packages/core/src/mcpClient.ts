import type { AuthProvider, Tool as SdkTool, Transport } from "@modelcontextprotocol/client";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { SandboxMode, Tool, ToolResult } from "@ninjacode/tools";
import { buildExecutionEnv, sandboxCommand, ToolError } from "@ninjacode/tools";
import type { McpServerConfig } from "./mcpConfig.js";
import { expandEnvRefs } from "./mcpConfig.js";
import { mcpToolRisk, type McpToolAnnotations } from "./mcpPolicy.js";
import { toToolNameFragment } from "./slug.js";

export interface McpAuthPort {
  token(config: McpServerConfig): Promise<string | undefined>;
  onUnauthorized?(config: McpServerConfig): Promise<void>;
}

export interface McpExecutionOptions {
  workspaceRoot: string;
  agentDir: string;
  sandboxMode: SandboxMode;
  auth?: McpAuthPort;
  /** Test/embedding seam; production hosts use the configured stdio/HTTP transport. */
  transportFactory?: (config: McpServerConfig) => Transport;
  fetch?: typeof globalThis.fetch;
  /** Temporary rollback for one release; dynamic discovery remains the default. */
  dynamicDiscovery?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

const DEFAULT_EXECUTION: McpExecutionOptions = {
  workspaceRoot: process.cwd(),
  agentDir: `${process.cwd()}/.ninjacode`,
  sandboxMode: "workspace-write",
};

/** Thin adapter over the official MCP v2 client SDK. */
export class McpClient {
  private readonly config: McpServerConfig;
  private readonly execution: McpExecutionOptions;
  private readonly client: Client;
  private transport: Transport | null = null;
  private tools: McpToolDefinition[] = [];

  constructor(config: McpServerConfig, execution: McpExecutionOptions = DEFAULT_EXECUTION) {
    this.config = { ...config };
    this.execution = execution;
    this.client = new Client(
      { name: "ninjacode", version: "0.1.0" },
      {
        versionNegotiation: { mode: versionNegotiationMode(config) },
        cachePartition: config.cache?.partition ?? config.name,
        defaultCacheTtlMs: config.cache?.defaultTtlMs ?? 0,
        listMaxPages: 64,
        listChanged: {
          tools: {
            autoRefresh: true,
            debounceMs: 100,
            onChanged: (error, tools) => {
              if (!error && tools) this.tools = normalizeTools(tools);
            },
          },
        },
      },
    );
  }

  async connect(): Promise<void> {
    this.transport =
      this.execution.transportFactory?.(this.config) ??
      ((this.config.transport ?? (this.config.url ? "http" : "stdio")) === "http"
        ? this.httpTransport()
        : this.stdioTransport());
    await this.client.connect(this.transport, { timeout: 30_000 });
    await this.refreshTools();
  }

  listTools(): McpToolDefinition[] {
    return [...this.tools];
  }

  async refreshTools(): Promise<McpToolDefinition[]> {
    const listed = await this.client.listTools(undefined, { cacheMode: "refresh", timeout: 30_000 });
    this.tools = normalizeTools(listed.tools);
    return this.listTools();
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.client.callTool(
      { name, arguments: args },
      { signal, timeout: 30_000, maxTotalTimeout: 120_000 },
    );
    const output = formatToolResult(result);
    if (result.isError) throw new ToolError(output, "runtime");
    return output;
  }

  async listResources(): Promise<Array<{ uri: string; name?: string }>> {
    try {
      return (await this.client.listResources()).resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
      }));
    } catch {
      return [];
    }
  }

  async listPrompts(): Promise<Array<{ name: string; description?: string }>> {
    try {
      return (await this.client.listPrompts()).prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
      }));
    } catch {
      return [];
    }
  }

  getConfig(): McpServerConfig {
    // Return unresolved refs so status/reporting never serializes host secrets.
    return { ...this.config };
  }

  getProtocolInfo(): { version?: string; era?: "modern" | "legacy" } {
    return {
      version: this.client.getNegotiatedProtocolVersion(),
      era: this.client.getProtocolEra(),
    };
  }

  findTool(name: string): McpToolDefinition | undefined {
    return this.tools.find((tool) => tool.name === name);
  }

  /** Static catalog fallback when dynamicDiscovery is disabled. */
  asNinjaTools(): Tool[] {
    return this.tools.map((tool) => {
      const serverName = this.config.name;
      return {
        name: toToolNameFragment(`mcp_${serverName}_${tool.name}`),
        description: `[MCP:${serverName}] ${tool.description ?? tool.name}`,
        risk: mcpToolRisk(this.config, tool.annotations),
        grantPolicy: () => "never" as const,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        target: (args) => `${serverName}:${tool.name}:${JSON.stringify(args).slice(0, 60)}`,
        execute: async (ctx, args): Promise<ToolResult> => ({
          output: await this.callTool(tool.name, args, ctx.signal),
        }),
      } satisfies Tool;
    });
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
    this.transport = null;
  }

  private stdioTransport(): Transport {
    if (!this.config.command) {
      throw new Error(`MCP server ${this.config.name}: command required for stdio`);
    }
    const env = buildExecutionEnv(process.env, expandEnvRefs(this.config.env));
    const wrapped = sandboxCommand({
      command: this.config.command,
      args: this.config.args ?? [],
      cwd: this.execution.workspaceRoot,
      workspaceRoot: this.execution.workspaceRoot,
      agentDir: this.execution.agentDir,
      mode: this.execution.sandboxMode,
      allowNetwork: this.config.trust === "trusted" && Boolean(this.config.networkDomains?.length),
      env,
    });
    return new StdioClientTransport({
      command: wrapped.command,
      args: wrapped.args,
      cwd: this.execution.workspaceRoot,
      env: definedEnv(env),
      stderr: "pipe",
      maxBufferSize: 10 * 1024 * 1024,
    });
  }

  private httpTransport(): Transport {
    if (!this.config.url) throw new Error(`MCP server ${this.config.name}: HTTP url required`);
    const url = new URL(this.config.url);
    assertAllowedHttpHost(this.config, url);
    const headers = {
      ...expandEnvRefs(this.config.routingHeaders),
      ...expandEnvRefs(this.config.headers),
    };
    const authProvider = this.authProvider();
    return new StreamableHTTPClientTransport(url, {
      requestInit: Object.keys(headers).length ? { headers } : undefined,
      authProvider,
      fetch: this.execution.fetch,
      onInsufficientScope: "throw",
      maxStepUpRetries: 0,
    });
  }

  private authProvider(): AuthProvider | undefined {
    if (!this.config.auth) return undefined;
    return {
      token: async () => {
        const fromHost = await this.execution.auth?.token(this.config);
        return fromHost ?? tokenFromEnvRef(this.config.auth?.tokenRef);
      },
      onUnauthorized: this.execution.auth?.onUnauthorized
        ? async () => this.execution.auth!.onUnauthorized!(this.config)
        : undefined,
    };
  }
}

function assertAllowedHttpHost(config: McpServerConfig, url: URL): void {
  const domains = config.networkDomains ?? [];
  if (domains.length === 0) return;
  const host = url.hostname.toLowerCase();
  const allowed = domains.some(
    (domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`),
  );
  if (!allowed) {
    throw new ToolError(`MCP server ${config.name} blocked host ${host}`, "permission");
  }
}

function versionNegotiationMode(
  config: McpServerConfig,
): "auto" | "legacy" | { pin: "2026-07-28" } {
  if (config.protocolVersion === "legacy") return "legacy";
  if (config.protocolVersion === "2026-07-28") return { pin: "2026-07-28" };
  return "auto";
}

function tokenFromEnvRef(ref?: string): string | undefined {
  const match = ref?.match(/^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  return match?.[1] ? process.env[match[1]] : undefined;
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function normalizeTools(tools: SdkTool[]): McpToolDefinition[] {
  return tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      annotations: tool.annotations as McpToolAnnotations | undefined,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function formatToolResult(result: {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
}): string {
  const text = result.content
    .map((content) =>
      content.type === "text" && typeof content.text === "string"
        ? content.text
        : JSON.stringify(content),
    )
    .join("\n");
  if (result.structuredContent === undefined) return text;
  const structured = JSON.stringify(result.structuredContent);
  return text ? `${text}\n\nStructured content:\n${structured}` : structured;
}
