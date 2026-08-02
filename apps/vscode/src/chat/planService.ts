import * as vscode from "vscode";
import { t } from "../locale.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  deletePlan,
  listPlans,
  loadSessionSafe,
  planContentForDisplay,
  planIdForSession,
  readPlan,
  renamePlanTitle,
  saveSession,
  type PlanRecord,
  type PlanSummary,
} from "@ninjacode/core";
import { PLAN_EDITOR_VIEW_TYPE } from "../planEditorProvider.js";
import type { HostToWebview, SettingsPayload, TodoUiItem } from "../protocol.js";
import { sessionHasPlan } from "./sessionHydrator.js";

const TASKS_START = "<!-- ninjacode:tasks:start -->";
const TASKS_END = "<!-- ninjacode:tasks:end -->";

function executePlanPrompt(relPath: string): string {
  return (
    `Implement the plan in \`${relPath}\`. ` +
    "Follow it step by step; do not re-plan unless blocked. A todo checklist of the plan's tasks already exists — " +
    "as you work, use todo_write (merge=true) to mark each task in_progress before you start it and completed once you have verified it. " +
    "Keep exactly one task in_progress at a time."
  );
}

interface PlanServiceDeps {
  /** Absolute `.ninjacode` directory of the active workspace, if any. */
  agentDir(): string | undefined;
  workspaceRoot(): string | undefined;
  activeSessionId(): string | undefined;
  post(sessionId: string | undefined, payload: HostToWebview): void;
  pushSettings(): Promise<void>;
  runMessage(sessionId: string | undefined, text: string, mode: "agent"): Promise<void>;
  settingsPayload(): Promise<SettingsPayload>;
  setModel(model: string): Promise<void>;
  isBusy(): boolean;
  refreshPlanEditors(planId: string): Promise<void>;
}

/** Owns versioned plans under `.ninjacode/plans/` and `.ninjacode/todos.json`. */
export class PlanService {
  constructor(private readonly deps: PlanServiceDeps) {}

  private todosPath(): string | undefined {
    const dir = this.deps.agentDir();
    return dir ? path.join(dir, "todos.json") : undefined;
  }

  /** Resolve the active plan id for a session (persisted override or session hash). */
  async activePlanId(sessionId: string | undefined): Promise<string | undefined> {
    const dir = this.deps.agentDir();
    if (!sessionId || !dir) return undefined;
    const saved = await loadSessionSafe(dir, sessionId);
    return saved?.config.planId ?? planIdForSession(sessionId);
  }

  clear(sessionId?: string): void {
    this.deps.post(sessionId, { type: "plan_clear" });
  }

  /** Show the plan panel only for sessions that actually produced one. */
  async syncPanelForSession(sessionId: string | undefined): Promise<void> {
    const dir = this.deps.agentDir();
    if (!sessionId || !dir) {
      this.clear();
      return;
    }
    const saved = await loadSessionSafe(dir, sessionId);
    if (saved && sessionHasPlan(saved)) await this.refresh(sessionId);
    else this.clear(sessionId);
  }

  async refresh(sessionId?: string): Promise<void> {
    const dir = this.deps.agentDir();
    if (!dir) {
      this.clear(sessionId);
      return;
    }
    const planId = await this.activePlanId(sessionId);
    if (!planId) {
      this.clear(sessionId);
      return;
    }
    const record = await readPlan(dir, planId);
    if (!record?.content.trim()) {
      this.clear(sessionId);
      return;
    }
    this.deps.post(sessionId, {
      type: "plan",
      planId: record.id,
      title: record.title,
      path: record.relPath,
      content: planContentForDisplay(record.content),
    });
    void this.syncEditorPanel(record);
  }

  /** Keep open plan custom editors in sync (content, model list, busy state). */
  async syncEditorPanel(record?: PlanRecord): Promise<void> {
    const planId = record?.id ?? (await this.activePlanId(this.deps.activeSessionId()));
    if (!planId) return;
    await this.deps.refreshPlanEditors(planId);
  }

  async list(): Promise<PlanSummary[]> {
    const dir = this.deps.agentDir();
    if (!dir) return [];
    return listPlans(dir);
  }

  async pushPlansList(sessionId?: string): Promise<void> {
    const items = await this.list();
    this.deps.post(sessionId, { type: "plans", items });
  }

  /** Push the todo list to the panel — called mid-run after `todo_write` and again at the end. */
  async refreshTodos(sessionId?: string): Promise<void> {
    const items = await this.readTodos();
    this.deps.post(sessionId, {
      type: "todos",
      items: items.map((t, i) => ({ id: t.id ?? String(i), content: t.content, status: t.status })),
    });
  }

  /** Reset workspace todos so a new chat does not inherit the previous run's list. */
  async clearTodos(): Promise<void> {
    const file = this.todosPath();
    if (file) {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "[]\n", "utf8");
      } catch {
        // non-fatal
      }
    }
    this.deps.post(undefined, { type: "todos", items: [] });
  }

  private async readTodos(): Promise<Array<Partial<TodoUiItem> & { status: string; content: string }>> {
    const file = this.todosPath();
    if (!file) return [];
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async planFileForSession(sessionId?: string, planId?: string): Promise<string | undefined> {
    const dir = this.deps.agentDir();
    const resolvedId = planId ?? (await this.activePlanId(sessionId));
    if (!dir || !resolvedId) return undefined;
    const record = await readPlan(dir, resolvedId);
    return record?.file;
  }

  /**
   * Keep a managed "## Tasks" block in the active plan in sync with todos.json.
   * Writing here emits no tool event, so it cannot loop.
   */
  async syncTodosIntoPlan(sessionId?: string): Promise<void> {
    const file = await this.planFileForSession(sessionId);
    if (!file) return;

    let content: string;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      return;
    }

    const todos = await this.readTodos();
    const base = stripTasksBlock(content);
    const next =
      todos.length > 0
        ? `${base.replace(/\s+$/, "")}\n\n${renderTasksBlock(todos)}\n`
        : `${base}\n`;
    if (next === content) return;

    try {
      await fs.writeFile(file, next, "utf8");
      await this.refresh(sessionId);
    } catch {
      // non-fatal
    }
  }

  async openEditor(sessionId?: string, planId?: string): Promise<void> {
    const dir = this.deps.agentDir();
    if (!dir) {
      vscode.window.showWarningMessage(t("Open a workspace folder first."));
      return;
    }
    const resolvedId = planId ?? (await this.activePlanId(sessionId));
    if (!resolvedId) {
      vscode.window.showWarningMessage(t("No plan found yet. Create one in Plan mode first."));
      return;
    }
    const record = await readPlan(dir, resolvedId);
    if (!record) {
      vscode.window.showWarningMessage(t("No plan found yet. Create one in Plan mode first."));
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.openWith",
      vscode.Uri.file(record.file),
      PLAN_EDITOR_VIEW_TYPE,
    );
  }

  async openMarkdownPreview(sessionId?: string, planId?: string): Promise<void> {
    const file = await this.planFileForSession(sessionId, planId);
    if (!file) {
      vscode.window.showWarningMessage(t("No plan found yet. Create one in Plan mode first."));
      return;
    }
    await vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.file(file));
  }

  /** Switch to agent mode and run a plan (session active plan unless planId is set). */
  async execute(sessionId: string | undefined, model?: string, planId?: string): Promise<void> {
    if (!this.deps.workspaceRoot()) {
      vscode.window.showWarningMessage(t("Open a workspace folder first."));
      return;
    }
    const dir = this.deps.agentDir();
    const resolvedId = planId ?? (await this.activePlanId(sessionId));
    if (!dir || !resolvedId) return;
    const record = await readPlan(dir, resolvedId);
    if (!record) {
      vscode.window.showWarningMessage(t("No plan found. Create one in Plan mode first."));
      return;
    }
    const cfg = vscode.workspace.getConfiguration("ninjacode");
    if (model) await cfg.update("model", model, vscode.ConfigurationTarget.Workspace);
    await cfg.update("mode", "agent", vscode.ConfigurationTarget.Workspace);
    this.deps.post(sessionId, { type: "mode", mode: "agent" });
    await this.deps.pushSettings();
    await this.deps.runMessage(sessionId, executePlanPrompt(record.relPath), "agent");
  }

  /** Attach an existing plan from history to the current session. */
  async activate(sessionId: string | undefined, planId: string): Promise<void> {
    const dir = this.deps.agentDir();
    if (!dir || !sessionId) return;
    const record = await readPlan(dir, planId);
    if (!record) return;
    const saved = await loadSessionSafe(dir, sessionId);
    if (!saved) return;
    await saveSession(dir, {
      ...saved,
      config: { ...saved.config, planId },
      updatedAt: new Date().toISOString(),
    });
    await this.refresh(sessionId);
    await this.pushPlansList(sessionId);
  }

  async rename(sessionId: string | undefined, planId: string, title: string): Promise<void> {
    const dir = this.deps.agentDir();
    if (!dir) return;
    await renamePlanTitle(dir, planId, title);
    await this.refresh(sessionId);
    await this.pushPlansList(sessionId);
  }

  async remove(sessionId: string | undefined, planId: string): Promise<void> {
    const dir = this.deps.agentDir();
    if (!dir) return;
    await deletePlan(dir, planId);
    const active = await this.activePlanId(sessionId);
    if (active === planId) this.clear(sessionId);
    await this.pushPlansList(sessionId);
  }
}

function stripTasksBlock(text: string): string {
  const startIdx = text.indexOf(TASKS_START);
  const endIdx = text.indexOf(TASKS_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return text;
  const before = text.slice(0, startIdx).replace(/\s+$/, "");
  const after = text.slice(endIdx + TASKS_END.length).replace(/^\s+/, "");
  return after ? `${before}\n\n${after}` : before;
}

function renderTasksBlock(todos: Array<{ status: string; content: string }>): string {
  const lines = todos.map((t) => {
    switch (t.status) {
      case "completed":
        return `- [x] ${t.content}`;
      case "in_progress":
        return `- [ ] ⟳ ${t.content}`;
      case "cancelled":
        return `- [x] ~~${t.content}~~`;
      default:
        return `- [ ] ${t.content}`;
    }
  });
  return [TASKS_START, "## Tasks", ...lines, TASKS_END].join("\n");
}
