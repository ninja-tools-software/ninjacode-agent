import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "@ninjacode/tools";

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  routingHeaders?: Record<string, string>;
  transport?: "stdio" | "http";
  enabled?: boolean;
  trust?: "trusted" | "untrusted";
  provenance?: "workspace" | "user" | "managed";
  networkDomains?: string[];
  protocolVersion?: "auto" | "legacy" | "2026-07-28";
  cache?: {
    defaultTtlMs?: number;
    scope?: "public" | "private";
    partition?: string;
  };
  auth?: {
    type: "bearer" | "oauth";
    tokenRef?: string;
    scopes?: string[];
    flow?: "authorization_code" | "device_code" | "client_credentials";
    clientId?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    deviceAuthorizationEndpoint?: string;
  };
}

export interface McpConfigFile {
  mcpServers: Record<string, Omit<McpServerConfig, "name">>;
}

/** Config file we create when a workspace has none yet. */
export const MCP_CONFIG_REL = path.join(".ninjacode", "mcp.json");

/**
 * Replace `${env:NAME}` references with values from the host environment, so
 * tokens can live in the shell instead of a committed config file.
 */
export function expandEnvRefs(
  values: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!values) return values;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
      return process.env[name] ?? "";
    });
  }
  return out;
}

function mcpConfigCandidates(workspaceRoot: string): string[] {
  return [path.join(workspaceRoot, MCP_CONFIG_REL), path.join(workspaceRoot, ".mcp.json")];
}

export async function loadMcpConfigFile(
  workspaceRoot: string,
): Promise<{ file: string | null; servers: McpServerConfig[] }> {
  for (const file of mcpConfigCandidates(workspaceRoot)) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as McpConfigFile;
      const servers = Object.entries(parsed.mcpServers ?? {}).map(([name, cfg]) => ({
        name,
        ...cfg,
      }));
      return { file, servers };
    } catch {
      // try next
    }
  }
  return { file: null, servers: [] };
}

export async function loadMcpConfig(workspaceRoot: string): Promise<McpServerConfig[]> {
  return (await loadMcpConfigFile(workspaceRoot)).servers;
}

export function validateMcpServer(config: McpServerConfig): string[] {
  const errors: string[] = [];
  if (!config.name?.trim()) errors.push("Name is required");
  else if (!/^[A-Za-z0-9_.-]+$/.test(config.name)) {
    errors.push("Name may only contain letters, digits, dot, dash and underscore");
  }
  const transport = config.transport ?? (config.url ? "http" : "stdio");
  if (transport === "http") {
    if (!config.url?.trim()) errors.push("URL is required for the http transport");
    else if (!/^https?:\/\//.test(config.url.trim())) errors.push("URL must start with http(s)://");
  } else if (!config.command?.trim()) {
    errors.push("Command is required for the stdio transport");
  }
  if (config.auth && transport !== "http") {
    errors.push("Auth is only supported for the http transport");
  }
  if (config.cache?.defaultTtlMs != null && config.cache.defaultTtlMs < 0) {
    errors.push("Cache defaultTtlMs must be non-negative");
  }
  return errors;
}

export async function writeMcpConfig(
  workspaceRoot: string,
  servers: McpServerConfig[],
): Promise<string> {
  const { file } = await loadMcpConfigFile(workspaceRoot);
  const target = file ?? path.join(workspaceRoot, MCP_CONFIG_REL);

  let existing: Record<string, unknown> = {};
  if (file) {
    try {
      existing = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const mcpServers: McpConfigFile["mcpServers"] = {};
  for (const server of servers) {
    const { name, ...rest } = server;
    mcpServers[name] = rest;
  }
  existing.mcpServers = mcpServers;

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  return target;
}

export async function upsertMcpServer(
  workspaceRoot: string,
  config: McpServerConfig,
  previousName?: string,
): Promise<string> {
  const errors = validateMcpServer(config);
  if (errors.length) throw new ToolError(errors.join("; "), "invalid_args");

  const { servers } = await loadMcpConfigFile(workspaceRoot);
  const key = previousName ?? config.name;
  const index = servers.findIndex((s) => s.name === key);
  if (index >= 0) servers[index] = config;
  else servers.push(config);
  return writeMcpConfig(workspaceRoot, servers);
}

export async function removeMcpServer(workspaceRoot: string, name: string): Promise<string> {
  const { servers } = await loadMcpConfigFile(workspaceRoot);
  return writeMcpConfig(
    workspaceRoot,
    servers.filter((s) => s.name !== name),
  );
}

export async function setMcpServerEnabled(
  workspaceRoot: string,
  name: string,
  enabled: boolean,
): Promise<string> {
  const { servers } = await loadMcpConfigFile(workspaceRoot);
  return writeMcpConfig(
    workspaceRoot,
    servers.map((s) => (s.name === name ? { ...s, enabled } : s)),
  );
}
