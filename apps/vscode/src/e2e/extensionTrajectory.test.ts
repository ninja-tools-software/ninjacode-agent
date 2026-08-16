import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Agent,
  PermissionEngine,
  defaultPermissionPolicy,
  type AgentEvent,
  type ApprovalRequest,
} from "@ninjacode/core";
import { MockProvider } from "@ninjacode/providers";
import { createDefaultToolRegistry, ToolRegistry, type Tool } from "@ninjacode/tools";

const temporaryDirs: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function baseOptions(workspaceRoot: string) {
  return {
    workspaceRoot,
    persistSessions: false,
    enableCheckpoints: false,
    enableSubagents: false,
    sandboxMode: "danger-full-access" as const,
    runTimeoutMs: 10_000,
  };
}

/**
 * Host-level trajectories use the real agent loop and tools without Electron.
 * extensionHost.ts separately covers activation when a local VS Code binary exists.
 */
describe("VS Code extension trajectory", () => {
  it("streams, requests approval, and performs a real workspace edit", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-vscode-trajectory-"));
    temporaryDirs.push(workspaceRoot);
    const events: AgentEvent[] = [];
    const approvals: ApprovalRequest[] = [];
    const agent = new Agent({
      ...baseOptions(workspaceRoot),
      provider: new MockProvider([
        {
          text: "editing",
          toolCalls: [
            { id: "edit-1", name: "write_file", arguments: { path: "result.txt", content: "done\n" } },
          ],
        },
        { text: "finished" },
      ]),
      tools: createDefaultToolRegistry({ includeNetwork: false }),
      permissions: new PermissionEngine(defaultPermissionPolicy("balanced")),
      onApproval: async (request) => {
        approvals.push(request);
        return { approved: true };
      },
      onEvent: (event) => {
        events.push(event);
      },
    });

    const outcome = await agent.run("edit result.txt");

    expect(outcome.completed).toBe(true);
    expect(await fs.readFile(path.join(workspaceRoot, "result.txt"), "utf8")).toBe("done\n");
    expect(approvals).toEqual([expect.objectContaining({ toolName: "write_file" })]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_start",
          payload: expect.objectContaining({ id: "edit-1" }),
        }),
        expect.objectContaining({
          type: "tool_end",
          payload: expect.objectContaining({ id: "edit-1" }),
        }),
      ]),
    );
  });

  it("aborts an in-flight tool and resumes with a fresh run", async () => {
    const slowTool: Tool = {
      name: "slow_tool",
      description: "Wait until aborted",
      risk: "read_only",
      inputSchema: { type: "object", properties: {} },
      target: () => "slow",
      execute: async (context) => {
        await waitForAbort(context.signal);
        return { output: "unexpected" };
      },
    };
    let shouldAbort = true;
    let abortAgent: () => void = () => undefined;
    const agent = new Agent({
      ...baseOptions(process.cwd()),
      provider: new MockProvider([
        { text: "working", toolCalls: [{ id: "slow-1", name: "slow_tool", arguments: {} }] },
        { text: "resumed" },
      ]),
      tools: new ToolRegistry().register(slowTool),
      permissions: new PermissionEngine(defaultPermissionPolicy("autonomous")),
      onEvent: (event) => {
        if (event.type === "tool_start" && shouldAbort) {
          shouldAbort = false;
          abortAgent();
        }
      },
    });
    abortAgent = () => agent.abort(new DOMException("stop", "AbortError"));

    const interrupted = await agent.run("start");
    const resumed = await agent.run("continue");

    expect(interrupted.completed).toBe(false);
    expect(resumed.completed).toBe(true);
    expect(resumed.answer).toContain("resumed");
  });
});

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) throw new Error("missing test abort signal");
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
