import { loadMcpConfig, loadMcpToolsWithStatus, type McpClient, type McpServerStatus } from "@ninjacode/core";
import type { Tool } from "@ninjacode/tools";
import { isWorkspaceTrusted, warnIfUntrustedWorkspace } from "../workspaceTrust.js";

/**
 * Long-lived MCP connections, cached per workspace root so the same clients are
 * reused across agent runs instead of reconnecting every turn.
 */
export class McpService {
  private readonly clients = new Map<string, McpClient[]>();
  private readonly statuses = new Map<string, McpServerStatus[]>();

  /** Connect (once) and cache clients + per-server status. Never throws: connection
   * failures are captured per-server in `statuses`. */
  async ensure(workspaceRoot: string): Promise<{ clients: McpClient[]; statuses: McpServerStatus[] }> {
    if (!isWorkspaceTrusted()) {
      warnIfUntrustedWorkspace();
      return { clients: [], statuses: [] };
    }
    let clients = this.clients.get(workspaceRoot);
    let statuses = this.statuses.get(workspaceRoot);
    if (!clients || !statuses) {
      const configs = await loadMcpConfig(workspaceRoot);
      if (configs.length) {
        const result = await loadMcpToolsWithStatus(configs);
        clients = result.clients;
        statuses = result.statuses;
      } else {
        clients = [];
        statuses = [];
      }
      this.clients.set(workspaceRoot, clients);
      this.statuses.set(workspaceRoot, statuses);
    }
    return { clients, statuses };
  }

  async tools(workspaceRoot: string): Promise<Tool[]> {
    const { clients } = await this.ensure(workspaceRoot);
    return clients.flatMap((c) => c.asNinjaTools());
  }

  /** Close and forget connections, so the next `ensure` reconnects with current config. */
  async close(workspaceRoot?: string): Promise<void> {
    const entries = workspaceRoot
      ? ([[workspaceRoot, this.clients.get(workspaceRoot)]] as const)
      : [...this.clients.entries()];
    for (const [root, clients] of entries) {
      if (!clients) continue;
      await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
      this.clients.delete(root);
      this.statuses.delete(root);
    }
  }
}
