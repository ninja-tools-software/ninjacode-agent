import * as vscode from "vscode";
import type { Checkpoint } from "@ninjacode/core";

export class CheckpointsTreeProvider implements vscode.TreeDataProvider<CheckpointItem> {
  private readonly _onDidChange = new vscode.EventEmitter<CheckpointItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly getCheckpoints: () => Checkpoint[]) {}

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: CheckpointItem): vscode.TreeItem {
    return element;
  }

  getChildren(): CheckpointItem[] {
    return this.getCheckpoints()
      .slice()
      .reverse()
      .map((c) => new CheckpointItem(c));
  }
}

class CheckpointItem extends vscode.TreeItem {
  constructor(public readonly checkpoint: Checkpoint) {
    super(checkpoint.label, vscode.TreeItemCollapsibleState.None);
    this.description = checkpoint.createdAt;
    this.tooltip = checkpoint.commitHash;
    this.command = {
      command: "ninjacode.restoreCheckpoint",
      title: "Restore",
      arguments: [],
    };
    this.iconPath = new vscode.ThemeIcon("history");
  }
}
