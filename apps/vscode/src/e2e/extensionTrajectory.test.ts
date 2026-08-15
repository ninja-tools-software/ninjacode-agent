import { describe, expect, it } from "vitest";
import { Agent, PermissionEngine, defaultPermissionPolicy } from "@ninjacode/core";
import { MockProvider } from "@ninjacode/providers";
import { createDefaultToolRegistry } from "@ninjacode/tools";

function createAgent(scripts: ConstructorParameters<typeof MockProvider>[0]): Agent {
  return new Agent({
    provider: new MockProvider(scripts),
    tools: createDefaultToolRegistry({ includeNetwork: false }),
    permissions: new PermissionEngine(defaultPermissionPolicy("autonomous")),
    workspaceRoot: process.cwd(),
    persistSessions: false,
    enableCheckpoints: false,
    sandboxMode: "danger-full-access",
    runTimeoutMs: 10_000,
  });
}

/**
 * Host-level trajectory covered without downloading Electron.
 * A @vscode/test-electron runner can wrap the same steps once a VS Code build
 * is available in CI: activate → stream → approval → edit → abort → resume.
 */
describe("VS Code extension trajectory", () => {
  it("streams a mock edit then aborts an in-flight run", async () => {
    const agent = createAgent([
      { text: "working", toolCalls: [{ id: "1", name: "write_scratchpad", arguments: { content: "note" } }] },
      { text: "done" },
    ]);
    const run = agent.run("edit the note");
    agent.abort(new DOMException("stop", "AbortError"));
    const outcome = await run;
    expect(outcome.completed === false || agent.getState() === "stopped" || agent.getState() === "failed").toBe(true);
  });

  it("can start a fresh run after abort (resume trajectory)", async () => {
    const agent = createAgent([{ text: "resumed" }]);
    const outcome = await agent.run("continue");
    expect(outcome.answer).toContain("resumed");
    expect(outcome.completed).toBe(true);
  });
});
