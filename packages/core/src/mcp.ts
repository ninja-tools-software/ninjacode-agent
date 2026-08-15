import type { Tool } from "@ninjacode/tools";
import { McpCatalog } from "./mcpCatalog.js";
import { McpClient } from "./mcpClient.js";
import type { McpExecutionOptions } from "./mcpClient.js";
import type { McpServerConfig } from "./mcpConfig.js";

export async function loadMcpTools(
  configs: McpServerConfig[],
  execution?: McpExecutionOptions,
): Promise<{ tools: Tool[]; clients: McpClient[] }> {
  const { tools, clients } = await loadMcpToolsWithStatus(configs, execution);
  return { tools, clients };
}

export interface McpServerStatus {
  name: string;
  transport: "stdio" | "http";
  status: "connected" | "error" | "disabled";
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
  resources: Array<{ uri: string; name?: string }>;
  prompts: Array<{ name: string; description?: string }>;
  error?: string;
  config?: McpServerConfig;
  protocolVersion?: string;
  protocolEra?: "modern" | "legacy";
}

export async function loadMcpToolsWithStatus(
  configs: McpServerConfig[],
  execution?: McpExecutionOptions,
): Promise<{ tools: Tool[]; clients: McpClient[]; statuses: McpServerStatus[] }> {
  const tools: Tool[] = [];
  const clients: McpClient[] = [];
  const statuses: McpServerStatus[] = [];

  for (const cfg of configs) {
    const transport = cfg.transport ?? (cfg.url ? "http" : "stdio");
    if (cfg.enabled === false) {
      statuses.push(disabledStatus(cfg, transport));
      continue;
    }

    const connected = await connectMcpServer(cfg, transport, execution);
    if ("error" in connected) {
      console.warn(`[mcp] failed to connect ${cfg.name}: ${connected.error}`);
      statuses.push(connected.status);
      continue;
    }

    clients.push(connected.client);
    statuses.push(connected.status);
  }

  if (clients.length > 0) {
    tools.push(
      ...(execution?.dynamicDiscovery === false
        ? clients.flatMap((client) => client.asNinjaTools())
        : new McpCatalog(clients).asNinjaTools()),
    );
  }
  return { tools, clients, statuses };
}

function disabledStatus(cfg: McpServerConfig, transport: "stdio" | "http"): McpServerStatus {
  return {
    name: cfg.name,
    transport,
    status: "disabled",
    toolCount: 0,
    tools: [],
    resources: [],
    prompts: [],
    config: cfg,
  };
}

async function connectMcpServer(
  cfg: McpServerConfig,
  transport: "stdio" | "http",
  execution?: McpExecutionOptions,
): Promise<
  | { error: string; status: McpServerStatus; client?: never }
  | { client: McpClient; status: McpServerStatus; error?: never }
> {
  try {
    const client = new McpClient(cfg, execution);
    await client.connect();
    const protocol = client.getProtocolInfo();
    const [resources, prompts] = await Promise.all([client.listResources(), client.listPrompts()]);
    return {
      client,
      status: {
        name: cfg.name,
        transport,
        status: "connected",
        toolCount: client.listTools().length,
        tools: client.listTools().map((t) => ({ name: t.name, description: t.description })),
        resources,
        prompts,
        config: cfg,
        protocolVersion: protocol.version,
        protocolEra: protocol.era,
      },
    };
  } catch (e) {
    const message = (e as Error).message;
    return {
      error: message,
      status: {
        name: cfg.name,
        transport,
        status: "error",
        toolCount: 0,
        tools: [],
        resources: [],
        prompts: [],
        error: message,
        config: cfg,
      },
    };
  }
}
