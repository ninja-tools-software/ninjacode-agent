import type { RiskClass } from "@ninjacode/tools";
import type { McpServerConfig } from "./mcpConfig.js";

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Server annotations are untrusted hints. Only an explicitly trusted server
 * with an explicit read-only declaration may receive the lower network risk.
 */
export function mcpToolRisk(
  server: McpServerConfig,
  annotations: McpToolAnnotations | undefined,
): RiskClass {
  if (server.trust !== "trusted") return "destructive";
  if (server.provenance === "workspace") return "destructive";
  if (annotations?.readOnlyHint !== true || annotations.destructiveHint === true) {
    return "destructive";
  }
  return "network";
}
