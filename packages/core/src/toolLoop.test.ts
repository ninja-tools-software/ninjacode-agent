import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import type { Completion, CompletionRequest, LlmProvider, Message } from "@ninjacode/providers";
import { Agent } from "./agent.js";
import { evaluateToolLoop, recordToolCalls } from "./agentTurnCompletion.js";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";
import { isValidToolChain } from "./toolHistory.js";
import type { AgentOutcome } from "./types.js";

function repeatCall(times: number): string[] {
  const fingerprints: string[] = [];
  for (let i = 0; i < times; i++) {
    recordToolCalls(fingerprints, [{ name: "read_file", arguments: { path: "a.ts" } }]);
  }
  return fingerprints;
}

describe("evaluateToolLoop", () => {
  it("stays silent while calls differ", () => {
    const fingerprints: string[] = [];
    for (let i = 0; i < 8; i++) {
      recordToolCalls(fingerprints, [{ name: "read_file", arguments: { path: `a${i}.ts` } }]);
    }
    expect(evaluateToolLoop(fingerprints, true).action).toBe("none");
  });

  it("warns once the same call repeats four times", () => {
    const decision = evaluateToolLoop(repeatCall(4), true);
    expect(decision.action).toBe("warn");
  });

  it("stops the run when the warning changed nothing", () => {
    const decision = evaluateToolLoop(repeatCall(7), true);
    expect(decision.action).toBe("stop");
    if (decision.action === "stop") expect(decision.message).toContain("without progress");
  });

  it("ignores argument key order when fingerprinting", () => {
    const fingerprints: string[] = [];
    for (let i = 0; i < 4; i++) {
      const args = i % 2 === 0 ? { path: "a.ts", limit: 5 } : { limit: 5, path: "a.ts" };
      recordToolCalls(fingerprints, [{ name: "read_file", arguments: args }]);
    }
    expect(evaluateToolLoop(fingerprints, true).action).toBe("warn");
  });

  it("does nothing when loop detection is disabled", () => {
    expect(evaluateToolLoop(repeatCall(12), false).action).toBe("none");
  });
});

/** Always asks for the same file — the shape of a stuck agent. */
class LoopingProvider implements LlmProvider {
  readonly name = "looping";
  calls = 0;

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(_req: CompletionRequest): Promise<Completion> {
    this.calls += 1;
    return {
      text: "Reading it again.",
      toolCalls: [{ id: `call_${this.calls}`, name: "read_file", arguments: { path: "loop.txt" } }],
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "looping",
      stopReason: "tool_use",
    };
  }
}

async function runLoopingAgent(): Promise<{ outcome: AgentOutcome; history: Message[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-loop-"));
  try {
    await fs.writeFile(path.join(dir, "loop.txt"), "some content\n".repeat(50));
    const tools = createDefaultToolRegistry();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    permissions.update({ allowlist: tools.names() });

    const agent = new Agent({
      provider: new LoopingProvider(),
      tools,
      permissions,
      workspaceRoot: dir,
      agentDir: path.join(dir, ".ninjacode"),
      enableCheckpoints: false,
      persistSessions: false,
      enableSubagents: false,
      maxTurns: 40,
    });

    const outcome = await agent.run("Read loop.txt forever");
    return { outcome, history: agent.getSession().history };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("a looping run terminates on its own", () => {
  it("stops well before max turns instead of warning forever", async () => {
    const { outcome } = await runLoopingAgent();

    expect(outcome.completed).toBe(false);
    expect(outcome.answer).toContain("Stopping");
    expect(outcome.turns.length).toBeLessThan(12);
  });

  it("keeps the tool chain valid despite the injected loop warning", async () => {
    const { history } = await runLoopingAgent();

    expect(isValidToolChain(history)).toBe(true);
    expect(history.some((m) => m.role === "tool" && m.content.includes("some content"))).toBe(true);
  });
});
