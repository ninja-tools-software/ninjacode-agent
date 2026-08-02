import type { Tool } from "@ninjacode/tools";
import { McpClient } from "./mcpClient.js";
import type { McpServerConfig } from "./mcpConfig.js";

export async function loadMcpTools(
  configs: McpServerConfig[],
): Promise<{ tools: Tool[]; clients: McpClient[] }> {
  const { tools, clients } = await loadMcpToolsWithStatus(configs);
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
}

export async function loadMcpToolsWithStatus(
  configs: McpServerConfig[],
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

    const connected = await connectMcpServer(cfg, transport);
    if ("error" in connected) {
      console.warn(`[mcp] failed to connect ${cfg.name}: ${connected.error}`);
      statuses.push(connected.status);
      continue;
    }

    tools.push(...connected.tools);
    clients.push(connected.client);
    statuses.push(connected.status);
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
): Promise<
  | { error: string; status: McpServerStatus; tools?: never; client?: never }
  | { tools: Tool[]; client: McpClient; status: McpServerStatus; error?: never }
> {
  try {
    const client = new McpClient(cfg);
    await client.connect();
    const clientTools = client.asNinjaTools();
    const [resources, prompts] = await Promise.all([client.listResources(), client.listPrompts()]);
    return {
      tools: clientTools,
      client,
      status: {
        name: cfg.name,
        transport,
        status: "connected",
        toolCount: clientTools.length,
        tools: client.listTools().map((t) => ({ name: t.name, description: t.description })),
        resources,
        prompts,
        config: cfg,
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
