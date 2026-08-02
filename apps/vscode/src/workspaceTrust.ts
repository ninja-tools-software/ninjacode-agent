import * as vscode from "vscode";
import { t } from "./locale.js";
import type { ApprovalMode } from "@ninjacode/core";

/** VS Code workspace trust gate for MCP / hooks / autonomous mode. */
export function isWorkspaceTrusted(): boolean {
  return vscode.workspace.isTrusted !== false;
}

export function clampApprovalForTrust(mode: ApprovalMode): ApprovalMode {
  if (isWorkspaceTrusted()) return mode;
  return mode === "autonomous" ? "balanced" : mode;
}

let warnedUntrusted = false;

export function warnIfUntrustedWorkspace(): void {
  if (isWorkspaceTrusted() || warnedUntrusted) return;
  warnedUntrusted = true;
  void vscode.window.showWarningMessage(
    t("NinjaCode: workspace is not trusted. MCP servers and workspace hooks are disabled until you trust the folder."),
  );
}
