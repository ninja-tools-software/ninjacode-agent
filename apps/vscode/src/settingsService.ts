import * as vscode from "vscode";
import type {
  AgentLogEntry,
  CustomAgentDefinition,
  McpServerStatus,
  RuleDiagnostic,
  SkillDefinition,
} from "@ninjacode/core";
import type { SettingsPayload } from "./protocol.js";
import {
  deleteSecretApiKey,
  getSecretApiKey,
  listConfiguredProviderKeys,
  setSecretApiKey,
} from "./secrets.js";
import { gatewayBaseFromConfig } from "./settingsGateway.js";
import { applySettings, handleSettingsMessage } from "./settingsHandlers.js";
import { buildSettingsPayload } from "./settingsPayload.js";
import { t } from "./locale.js";
import type { SettingsMessage } from "./settingsTypes.js";

export type { SettingsMessage } from "./settingsTypes.js";

/** Workspace-scoped extras shown in the Settings tab (owned by the chat provider,
 * which keeps the MCP clients alive for agent runs). */
export interface SettingsExtras {
  mcpServers: McpServerStatus[];
  skills: SkillDefinition[];
  customAgents: CustomAgentDefinition[];
  /** Every rules/instructions file found, included or not. */
  rules: RuleDiagnostic[];
  /** Workspace-relative MCP config file in use, null when none exists yet. */
  mcpConfigFile: string | null;
}

interface SettingsHostHooks {
  /** Re-focus the chat view (after the panel side changed). */
  focusChat(): Promise<void>;
  /** MCP servers, skills, rules and custom agents for the current workspace. */
  loadExtras(): Promise<SettingsExtras>;
  /** Redacted agent log entries. */
  agentLogs(): AgentLogEntry[];
  /** Close cached MCP clients so the next read reconnects with the current config. */
  reloadMcp(): Promise<void>;
}

/**
 * Single source of truth for everything the Settings surfaces read and write:
 * VS Code configuration, provider API keys (SecretStorage) and the gateway
 * account. Both the chat webview and the Settings editor tab go through it, and
 * `onDidChange` lets every surface refresh after a mutation — including edits
 * made in the native VS Code settings UI.
 */
export class SettingsService {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  /** Fires after config, API keys or the account changed (debounced). */
  readonly onDidChange = this.onDidChangeEmitter.event;
  private changeTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly hooks: SettingsHostHooks,
  ) {
    context.subscriptions.push(
      this,
      this.onDidChangeEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("ninjacode") ||
          e.affectsConfiguration("workbench.sideBar.location")
        ) {
          this.scheduleChange();
        }
      }),
    );
  }

  dispose(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
  }

  /** Coalesce the bursts of events a multi-key `applySettings` produces. */
  private scheduleChange(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      this.onDidChangeEmitter.fire();
    }, 120);
  }

  loadExtras(): Promise<SettingsExtras> {
    return this.hooks.loadExtras();
  }

  reloadMcp(): Promise<void> {
    return this.hooks.reloadMcp();
  }

  agentLogs(): AgentLogEntry[] {
    return this.hooks.agentLogs();
  }

  gatewayBase(): string {
    return gatewayBaseFromConfig();
  }

  async buildPayload(): Promise<SettingsPayload> {
    return buildSettingsPayload({
      listConfiguredKeys: (kinds) => listConfiguredProviderKeys(this.context, kinds),
      getGatewayKey: () => getSecretApiKey(this.context, "gateway"),
      correctModel: (model) => this.update("model", model),
    });
  }

  async handleMessage(msg: SettingsMessage): Promise<boolean> {
    if (msg.type === "update_settings") {
      await applySettings(msg, {
        focusChat: () => this.hooks.focusChat(),
        scheduleChange: () => this.scheduleChange(),
      });
      return true;
    }
    return handleSettingsMessage(msg, {
      update: (key, value) => this.update(key, value),
      setApiKey: (kind, key) => setSecretApiKey(this.context, key, kind),
      clearApiKey: (kind) => deleteSecretApiKey(this.context, kind),
      startMagicLink: async (email) => {
        const { startMagicLink } = await import("./settingsGateway.js");
        await startMagicLink(this.gatewayBase(), email);
      },
      startBrowserLogin: async () => {
        const { startBrowserLogin, webUrlFromConfig } = await import("./settingsGateway.js");
        await startBrowserLogin(webUrlFromConfig());
        vscode.window.showInformationMessage(
          t("NinjaCode: complete sign-in in your browser, then return here."),
        );
      },
      openSubscribe: (tier) => this.openSubscribe(tier),
      scheduleChange: () => this.scheduleChange(),
    });
  }

  private async update(key: string, value: unknown): Promise<void> {
    // Locale is a user preference — always global, not per-workspace.
    const target =
      key === "locale"
        ? vscode.ConfigurationTarget.Global
        : vscode.ConfigurationTarget.Workspace;
    await vscode.workspace.getConfiguration("ninjacode").update(key, value, target);
  }

  async applySettings(msg: SettingsMessage): Promise<void> {
    await applySettings(msg, {
      focusChat: () => this.hooks.focusChat(),
      scheduleChange: () => this.scheduleChange(),
    });
  }

  async openSubscribe(tier: string): Promise<void> {
    const key = await getSecretApiKey(this.context, "gateway");
    if (!key) {
      vscode.window.showWarningMessage(t("Sign in to NinjaCode Pass first."));
      await vscode.commands.executeCommand("ninjacode.openSettings");
      return;
    }
    const url = `${this.gatewayBase()}/v1/billing/checkout?key=${encodeURIComponent(key)}`;
    const dash = `${this.gatewayBase()}/dashboard?key=${encodeURIComponent(key)}&tier=${encodeURIComponent(tier)}`;
    await vscode.env.openExternal(vscode.Uri.parse(dash || url));
  }

  /** Persist a magic-link key and switch the active provider to the gateway. */
  async signInWithKey(key: string): Promise<void> {
    await setSecretApiKey(this.context, key, "gateway");
    await vscode.workspace
      .getConfiguration("ninjacode")
      .update("provider", "gateway", vscode.ConfigurationTarget.Global);
    this.scheduleChange();
  }

  /** Exchange a one-time VS Code auth code for an API key, then sign in. */
  async signInWithAuthCode(code: string): Promise<void> {
    const res = await fetch(`${this.gatewayBase()}/v1/auth/vscode/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      throw new Error(`Auth code rejected (${res.status})`);
    }
    const data = (await res.json()) as { apiKey?: string };
    if (!data.apiKey) throw new Error("Auth code response missing apiKey");
    await this.signInWithKey(data.apiKey);
  }
}
