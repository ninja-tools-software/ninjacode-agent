import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRegistry, sessionArtifactPaths } from "@ninjacode/tools";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";
import { ToolCircuitBreaker } from "./reliability.js";
import { ToolPipeline } from "./toolPipeline.js";
import { appendToolResults } from "./agentTurnCompletion.js";

describe("ToolPipeline artifact persistence", () => {
  it("archives the full output before the model view truncates it", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nc-pipeline-artifact-"));
    const agentDir = path.join(workspaceRoot, ".ninjacode");
    const fullOutput = `begin-${"x".repeat(30_000)}-end`;
    const events: Array<{ type: string; payload: unknown }> = [];
    const registry = new ToolRegistry().register({
      name: "large_read",
      description: "test",
      risk: "read_only",
      inputSchema: { type: "object", properties: {} },
      target: () => "large",
      execute: async () => ({ output: fullOutput }),
    });
    const pipeline = new ToolPipeline({
      signal: new AbortController().signal,
      permissions: new PermissionEngine(defaultPermissionPolicy("balanced")),
      breaker: new ToolCircuitBreaker(3),
      workspaceRoot,
      agentDir,
      sessionId: "session",
      planId: "plan",
      sandboxMode: "workspace-write",
      persistSessionContext: true,
      getState: () => "running",
      setState: async () => undefined,
      runHooks: async () => [],
      emit: async (type, payload) => {
        events.push({ type, payload });
      },
      logAgentEvent: () => undefined,
      waitOrAbort: async (promise) => promise,
      isAbortError: () => false,
      onModifiedFiles: () => undefined,
    });

    const [invocation] = await pipeline.executeToolCalls(registry, [
      { id: "call", name: "large_read", arguments: {} },
    ]);
    expect(invocation?.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(events).toEqual([
      expect.objectContaining({
        type: "tool_start",
        payload: expect.objectContaining({ id: "call", name: "large_read" }),
      }),
      expect.objectContaining({
        type: "tool_end",
        payload: expect.objectContaining({ id: "call", name: "large_read" }),
      }),
    ]);
    const files = sessionArtifactPaths(agentDir, "session", invocation!.artifactId!);
    expect(await fs.readFile(files.body, "utf8")).toBe(fullOutput);

    const history: import("@ninjacode/providers").Message[] = [];
    appendToolResults(history, [invocation!], (output) => output.slice(0, 20));
    expect(history[0]?.content).toContain("Full output archived as artifact");
    expect(history[0]?.content.length).toBeLessThan(500);
  });
});
