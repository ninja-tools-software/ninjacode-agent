import { describe, expect, it } from "vitest";

interface VsCodeApi {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (s: unknown) => void;
}

function createMockVsCodeApi(initial: unknown = {}): VsCodeApi & { messages: unknown[] } {
  let state = initial;
  const messages: unknown[] = [];
  return {
    messages,
    postMessage: (msg) => {
      messages.push(msg);
    },
    getState: () => state,
    setState: (s) => {
      state = s;
    },
  };
}

describe("mocked VS Code webview API", () => {
  it("preserves host state and records outbound messages", () => {
    const vscode = createMockVsCodeApi({ draft: "hello" });
    expect(vscode.getState()).toEqual({ draft: "hello" });
    vscode.setState({ draft: "world" });
    vscode.postMessage({ type: "ready" });
    expect(vscode.getState()).toEqual({ draft: "world" });
    expect(vscode.messages).toEqual([{ type: "ready" }]);
  });
});
