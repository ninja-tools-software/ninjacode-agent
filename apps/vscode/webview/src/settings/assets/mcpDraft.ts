import type { McpServerConfigItem } from "../../types.js";
import { recordToRows } from "./shared.js";

export interface McpDraft {
  previousName?: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  url: string;
  env: Array<[string, string]>;
  headers: Array<[string, string]>;
  enabled: boolean;
}

function defaultTransport(config?: McpServerConfigItem): "stdio" | "http" {
  if (config?.transport) return config.transport;
  return config?.url ? "http" : "stdio";
}

export function draftFromServer(config?: McpServerConfigItem): McpDraft {
  return {
    previousName: config?.name,
    name: config?.name ?? "",
    transport: defaultTransport(config),
    command: config?.command ?? "",
    args: (config?.args ?? []).join("\n"),
    url: config?.url ?? "",
    env: recordToRows(config?.env),
    headers: recordToRows(config?.headers),
    enabled: config?.enabled !== false,
  };
}
