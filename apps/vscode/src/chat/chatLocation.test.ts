import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import {
  CHAT_LOCATION_CONTEXT,
  chatViewIdFor,
  closeCommandFor,
  containerCommandFor,
  getChatLocation,
  getPrimarySidebarSide,
  resolveChatSide,
  syncChatLocationContext,
} from "./chatLocation.js";

function mockConfig(values: Record<string, unknown>) {
  const cfg = {
    get: vi.fn((key: string) => values[key]),
  };
  vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation((section?: string) => {
    if (section === "workbench") {
      return {
        get: vi.fn((key: string) => values[`workbench.${key}`]),
      } as unknown as vscode.WorkspaceConfiguration;
    }
    return cfg as unknown as vscode.WorkspaceConfiguration;
  });
  return cfg;
}

describe("resolveChatSide", () => {
  it("maps primary to the primary sidebar side", () => {
    expect(resolveChatSide("primary", "left")).toBe("left");
    expect(resolveChatSide("primary", "right")).toBe("right");
  });

  it("maps secondary to the opposite side", () => {
    expect(resolveChatSide("secondary", "left")).toBe("right");
    expect(resolveChatSide("secondary", "right")).toBe("left");
  });
});

describe("view and command helpers", () => {
  it("returns primary sidebar view and container commands", () => {
    expect(chatViewIdFor("primary")).toBe("ninjacode.chatViewLeft");
    expect(containerCommandFor("primary")).toBe("workbench.view.extension.ninjacode-left");
    expect(closeCommandFor("primary")).toBe("workbench.action.closeSidebar");
  });

  it("returns secondary sidebar view and container commands", () => {
    expect(chatViewIdFor("secondary")).toBe("ninjacode.chatView");
    expect(containerCommandFor("secondary")).toBe("workbench.view.extension.ninjacode");
    expect(closeCommandFor("secondary")).toBe("workbench.action.closeAuxiliaryBar");
  });
});

describe("getChatLocation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads chatLocation", () => {
    mockConfig({ chatLocation: "primary" });
    expect(getChatLocation()).toBe("primary");
  });

  it("defaults to secondary", () => {
    mockConfig({});
    expect(getChatLocation()).toBe("secondary");
  });
});

describe("getPrimarySidebarSide", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads workbench.sideBar.location", () => {
    mockConfig({ "workbench.sideBar.location": "right" });
    expect(getPrimarySidebarSide()).toBe("right");
  });

  it("defaults to left", () => {
    mockConfig({});
    expect(getPrimarySidebarSide()).toBe("left");
  });
});

describe("syncChatLocationContext", () => {
  beforeEach(() => {
    vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the chat location context key", async () => {
    mockConfig({ chatLocation: "primary" });
    await syncChatLocationContext();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      CHAT_LOCATION_CONTEXT,
      "primary",
    );
  });
});
