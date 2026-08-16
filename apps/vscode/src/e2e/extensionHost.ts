import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("ninjacode.ninjacode");
  assert.ok(extension, "The NinjaCode development extension was not discovered");

  await extension.activate();
  assert.equal(extension.isActive, true, "The NinjaCode extension did not activate");

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("ninjacode.openChat"), "openChat command is not registered");
  assert.ok(commands.includes("ninjacode.stopAgent"), "stopAgent command is not registered");

  await vscode.commands.executeCommand("ninjacode.stopAgent");
}
