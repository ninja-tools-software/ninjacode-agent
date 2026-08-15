import {
  createOAuthAuthPort,
  deviceCodeGrant,
  loadMcpConfig,
  loadMcpToolsWithStatus,
  type McpAuthPort,
  type McpClient,
  type McpOAuthHost,
  type McpServerConfig,
  type McpServerStatus,
  type SecretStore,
} from "@ninjacode/core";
import type { SandboxMode, Tool } from "@ninjacode/tools";
import * as vscode from "vscode";
import { isWorkspaceTrusted, warnIfUntrustedWorkspace } from "../workspaceTrust.js";

/**
 * Long-lived MCP connections, cached per workspace root so the same clients are
 * reused across agent runs instead of reconnecting every turn.
 */
export class McpService {
  private readonly clients = new Map<string, McpClient[]>();
  private readonly statuses = new Map<string, McpServerStatus[]>();
  private readonly registeredTools = new Map<string, Tool[]>();

  constructor(private readonly secrets?: vscode.SecretStorage) {}

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
        const result = await loadMcpToolsWithStatus(configs, {
          workspaceRoot,
          agentDir: `${workspaceRoot}/.ninjacode`,
          sandboxMode: vscode.workspace.getConfiguration("ninjacode").get<SandboxMode>(
            "sandboxMode",
            "workspace-write",
          ),
          auth: this.authPort(),
        });
        clients = result.clients;
        statuses = result.statuses;
        this.registeredTools.set(workspaceRoot, result.tools);
      } else {
        clients = [];
        statuses = [];
        this.registeredTools.set(workspaceRoot, []);
      }
      this.clients.set(workspaceRoot, clients);
      this.statuses.set(workspaceRoot, statuses);
    }
    return { clients, statuses };
  }

  async tools(workspaceRoot: string): Promise<Tool[]> {
    await this.ensure(workspaceRoot);
    return this.registeredTools.get(workspaceRoot) ?? [];
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
      this.registeredTools.delete(root);
    }
  }

  private authPort(): McpAuthPort | undefined {
    if (!this.secrets) return undefined;
    const store: SecretStore = {
      get: (key) => Promise.resolve(this.secrets!.get(key)),
      set: (key, value) => Promise.resolve(this.secrets!.store(key, value)),
      delete: (key) => Promise.resolve(this.secrets!.delete(key)),
    };
    const host: McpOAuthHost = {
      async authorize(config) {
        const auth = config.auth;
        if (
          auth?.flow === "device_code" &&
          auth.deviceAuthorizationEndpoint &&
          auth.tokenEndpoint &&
          auth.clientId
        ) {
          return deviceCodeGrant({
            deviceAuthorizationEndpoint: auth.deviceAuthorizationEndpoint,
            tokenEndpoint: auth.tokenEndpoint,
            clientId: auth.clientId,
            scopes: auth.scopes,
            onUserCode: async ({ userCode, verificationUri }) => {
              await vscode.env.openExternal(vscode.Uri.parse(verificationUri));
              await vscode.window.showInformationMessage(
                `NinjaCode MCP (${config.name}): enter code ${userCode}`,
              );
            },
          });
        }
        const existing = await store.get(secretKey(config));
        if (existing) {
          try {
            return JSON.parse(existing) as { accessToken: string };
          } catch {
            return { accessToken: existing };
          }
        }
        throw new Error(
          `MCP server ${config.name} requires OAuth. Store a token in SecretStorage or configure device_code endpoints.`,
        );
      },
    };
    return createOAuthAuthPort(host, store);
  }
}

function secretKey(config: McpServerConfig): string {
  const ref = config.auth?.tokenRef;
  return ref?.startsWith("secret:") ? ref.slice("secret:".length) : `ninjacode.mcp.${config.name}.token`;
}
