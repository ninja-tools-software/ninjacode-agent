import * as vscode from "vscode";
import { t } from "./locale.js";
import path from "node:path";
import {
  deleteCustomAgent,
  deleteRule,
  deleteSkill,
  discoverSkills,
  loadSkillBody,
  readRuleBody,
  removeMcpServer,
  setAssetEnabled,
  setMcpServerEnabled,
  upsertMcpServer,
  validateMcpServer,
  writeCustomAgent,
  writeRule,
  writeSkill,
  type McpServerConfig,
  type SkillContext,
} from "@ninjacode/core";

/** Asset families the Settings tab can manage. */
export type AssetFamily = "mcp" | "skill" | "rule" | "agent";

const ASSET_MESSAGE_TYPES = new Set([
  "asset_save",
  "asset_delete",
  "asset_toggle",
  "asset_open",
  "get_asset_body",
]);

export interface AssetMessage {
  type: string;
  kind?: AssetFamily;
  /** Name (mcp/skill/agent) or workspace-relative path (rule). */
  id?: string;
  /** Original name when renaming an MCP server. */
  previousId?: string;
  /** Workspace-relative file backing the asset, when it already exists. */
  path?: string;
  enabled?: boolean;
  payload?: Record<string, unknown>;
}

interface WorkspaceAssetsHooks {
  /** Re-read the workspace and push fresh extras to the Settings tab. */
  refresh(): Promise<void>;
  /** Drop cached MCP clients and reconnect (config changed). */
  reloadMcp(): Promise<void>;
  post(payload: Record<string, unknown>): void;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((v) => String(v).trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function asRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue;
    out[key] = String(raw ?? "");
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Create/update/delete/toggle MCP servers, skills, rules and custom agents from
 * the Settings tab. Every mutation goes through the `@ninjacode/core` writers so
 * the files stay in the exact format the agent's loaders expect, and the panel
 * is refreshed afterwards.
 */
export class WorkspaceAssetsService {
  constructor(private readonly hooks: WorkspaceAssetsHooks) {}

  static handles(type: string): boolean {
    return ASSET_MESSAGE_TYPES.has(type);
  }

  private root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async handleMessage(msg: AssetMessage): Promise<void> {
    const root = this.root();
    if (!root) {
      void vscode.window.showWarningMessage(t("Open a folder first: these settings are per-workspace."));
      return;
    }
    try {
      switch (msg.type) {
        case "asset_save":
          await this.save(root, msg);
          break;
        case "asset_delete":
          await this.remove(root, msg);
          break;
        case "asset_toggle":
          await this.toggle(root, msg);
          break;
        case "asset_open":
          await this.open(root, msg);
          return; // opening a file changes nothing
        case "get_asset_body":
          await this.sendBody(root, msg);
          return;
        default:
          return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.hooks.post({ type: "asset_error", kind: msg.kind, id: msg.id, message });
      void vscode.window.showErrorMessage(t("NinjaCode settings: {0}", message));
      return;
    }
    if (msg.kind === "mcp") await this.hooks.reloadMcp();
    await this.hooks.refresh();
  }

  private async save(root: string, msg: AssetMessage): Promise<void> {
    const p = msg.payload ?? {};
    switch (msg.kind) {
      case "mcp": {
        const config = this.mcpConfigFromPayload(p);
        const errors = validateMcpServer(config);
        if (errors.length) throw new Error(errors.join("; "));
        await upsertMcpServer(root, config, msg.previousId);
        return;
      }
      case "skill": {
        await writeSkill(root, {
          name: asString(p.name),
          description: asString(p.description),
          context: p.context === "fork" ? "fork" : ("inline" as SkillContext),
          allowedTools: asStringArray(p.allowedTools),
          body: asString(p.body),
          skillFile: msg.path,
        });
        return;
      }
      case "agent": {
        await writeCustomAgent(root, {
          name: asString(p.name),
          description: asString(p.description) || undefined,
          model: asString(p.model) || undefined,
          tools: asStringArray(p.tools),
          systemPrompt: asString(p.systemPrompt),
          path: msg.path,
        });
        return;
      }
      case "rule": {
        await writeRule(root, {
          name: asString(p.name),
          description: asString(p.description) || undefined,
          globs: asStringArray(p.globs),
          alwaysApply: typeof p.alwaysApply === "boolean" ? p.alwaysApply : undefined,
          body: asString(p.body),
          path: msg.path,
        });
        return;
      }
      default:
        return;
    }
  }

  private mcpConfigFromPayload(p: Record<string, unknown>): McpServerConfig {
    const transport = p.transport === "http" ? "http" : "stdio";
    return {
      name: asString(p.name).trim(),
      transport,
      command: transport === "stdio" ? asString(p.command).trim() || undefined : undefined,
      args: transport === "stdio" ? asStringArray(p.args) : undefined,
      env: transport === "stdio" ? asRecord(p.env) : undefined,
      url: transport === "http" ? asString(p.url).trim() || undefined : undefined,
      headers: transport === "http" ? asRecord(p.headers) : undefined,
      enabled: p.enabled === false ? false : undefined,
    };
  }

  private async remove(root: string, msg: AssetMessage): Promise<void> {
    const label = msg.kind === "rule" ? msg.path ?? msg.id : msg.id;
    const deleteLabel = t("Delete");
    const confirmed = await vscode.window.showWarningMessage(
      t('Delete {0} "{1}"?', msg.kind ?? "asset", label ?? ""),
      { modal: true, detail: t("The file is removed from disk.") },
      deleteLabel,
    );
    if (confirmed !== deleteLabel) return;

    switch (msg.kind) {
      case "mcp":
        await removeMcpServer(root, msg.id ?? "");
        return;
      case "skill":
        if (msg.path) await deleteSkill(root, msg.path);
        return;
      case "agent":
        if (msg.path) await deleteCustomAgent(root, msg.path);
        return;
      case "rule":
        if (msg.path) await deleteRule(root, msg.path);
        return;
      default:
        return;
    }
  }

  private async toggle(root: string, msg: AssetMessage): Promise<void> {
    const enabled = msg.enabled !== false;
    const id = msg.id ?? "";
    if (msg.kind === "mcp") {
      await setMcpServerEnabled(root, id, enabled);
      return;
    }
    if (msg.kind === "skill" || msg.kind === "agent" || msg.kind === "rule") {
      await setAssetEnabled(root, msg.kind, id, enabled);
    }
  }

  private async open(root: string, msg: AssetMessage): Promise<void> {
    const rel = msg.path;
    if (!rel) return;
    const uri = vscode.Uri.file(path.isAbsolute(rel) ? rel : path.join(root, rel));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /** Bodies are fetched on demand: they're too big to ship with every refresh. */
  private async sendBody(root: string, msg: AssetMessage): Promise<void> {
    if (msg.kind === "skill") {
      const skills = await discoverSkills(root).catch(() => []);
      const skill = skills.find((s) => s.name === msg.id);
      const body = skill ? await loadSkillBody(skill) : "";
      this.hooks.post({ type: "asset_body", kind: "skill", id: msg.id, body });
      return;
    }
    if (msg.kind === "rule" && msg.path) {
      const rule = await readRuleBody(root, msg.path).catch(() => ({ body: "" }));
      this.hooks.post({ type: "asset_body", kind: "rule", id: msg.id, ...rule });
    }
  }
}
