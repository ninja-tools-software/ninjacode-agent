import { afterEach, describe, expect, it, vi } from "vitest";

const abort = vi.fn();
const run = vi.fn(async () => ({ completed: true, answer: "ok", turns: [] }));

vi.mock("./agentFactory.js", () => ({
  createAgentFor: vi.fn(async () => ({
    run,
    abort,
    getState: () => "idle",
  })),
}));

import { handle } from "./rpcHandlers.js";
import { sessions } from "./sessionStore.js";

describe("ACP JSON-RPC smoke", () => {
  afterEach(() => {
    sessions.clear();
    abort.mockClear();
    run.mockClear();
  });

  it("covers initialize, session, prompt, approval and cancel", async () => {
    const writes: unknown[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(JSON.parse(String(chunk)));
      return true;
    });

    await handle({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd() } });
    const created = writes.find((msg) => (msg as { id?: number }).id === 2) as {
      result?: { sessionId?: string };
    };
    const sessionId = created.result?.sessionId;
    expect(sessionId).toBeTruthy();

    await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: { sessionId, prompt: "hello" },
    });
    expect(run).toHaveBeenCalledWith("hello");

    await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "session/request_permission_response",
      params: { sessionId, optionId: "allow_once" },
    });
    await handle({ jsonrpc: "2.0", id: 5, method: "session/cancel", params: { sessionId } });
    expect(abort).toHaveBeenCalled();

    write.mockRestore();
  });
});
