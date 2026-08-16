import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentEventHandler } from "./agentFactory.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAgentEventHandler", () => {
  it("correlates parallel tool updates with the core tool-call ids", async () => {
    const writes: Array<{
      params: { update: { sessionUpdate: string; toolCallId?: string } };
    }> = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(JSON.parse(String(chunk)));
      return true;
    });
    const handle = createAgentEventHandler("session");

    await handle({
      type: "tool_start",
      payload: { id: "call-a", name: "read_file", arguments: { path: "a.ts" }, target: "a.ts" },
    });
    await handle({
      type: "tool_start",
      payload: { id: "call-b", name: "read_file", arguments: { path: "b.ts" }, target: "b.ts" },
    });
    await handle({
      type: "tool_end",
      payload: { id: "call-b", name: "read_file", output: "b" },
    });
    await handle({
      type: "tool_end",
      payload: { id: "call-a", name: "read_file", output: "a" },
    });

    expect(writes.map((message) => message.params.update)).toEqual([
      expect.objectContaining({ sessionUpdate: "tool_call", toolCallId: "call-a" }),
      expect.objectContaining({ sessionUpdate: "tool_call", toolCallId: "call-b" }),
      expect.objectContaining({ sessionUpdate: "tool_call_update", toolCallId: "call-b" }),
      expect.objectContaining({ sessionUpdate: "tool_call_update", toolCallId: "call-a" }),
    ]);
  });

  it("surfaces checkpoint failures without turning them into RPC failures", async () => {
    const writes: unknown[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(JSON.parse(String(chunk)));
      return true;
    });

    await createAgentEventHandler("session")({
      type: "checkpoint_error",
      payload: { stage: "create", message: "git failed" },
    });

    expect(writes).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "agent_message_chunk",
            content: expect.objectContaining({ text: expect.stringContaining("git failed") }),
          }),
        }),
      }),
    ]);
  });
});
