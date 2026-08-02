import * as vscode from "vscode";

export type ChatLocation = "primary" | "secondary";
type SidebarSide = "left" | "right";

/** VS Code context key driving the `when` clauses in package.json. */
export const CHAT_LOCATION_CONTEXT = "ninjacode.chatLocation";

/** Which side of the workbench the Primary Side Bar occupies. */
export function getPrimarySidebarSide(): SidebarSide {
  return (
    vscode.workspace.getConfiguration("workbench").get<SidebarSide>("sideBar.location") ?? "left"
  );
}

/** The physical screen side where the chat panel appears for a given location. */
export function resolveChatSide(
  location: ChatLocation,
  primarySide: SidebarSide,
): SidebarSide {
  if (location === "primary") return primarySide;
  return primarySide === "left" ? "right" : "left";
}

export function chatViewIdFor(location: ChatLocation): string {
  return location === "primary" ? "ninjacode.chatViewLeft" : "ninjacode.chatView";
}

export function containerCommandFor(location: ChatLocation): string {
  return location === "primary"
    ? "workbench.view.extension.ninjacode-left"
    : "workbench.view.extension.ninjacode";
}

export function closeCommandFor(location: ChatLocation): string {
  return location === "primary"
    ? "workbench.action.closeSidebar"
    : "workbench.action.closeAuxiliaryBar";
}

export function getChatLocation(): ChatLocation {
  const location = vscode.workspace.getConfiguration("ninjacode").get<ChatLocation>("chatLocation");
  if (location === "primary" || location === "secondary") return location;
  return "secondary";
}

export async function syncChatLocationContext(): Promise<void> {
  await vscode.commands.executeCommand("setContext", CHAT_LOCATION_CONTEXT, getChatLocation());
}
