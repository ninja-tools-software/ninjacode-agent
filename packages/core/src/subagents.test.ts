import { MockProvider } from "@ninjacode/providers";
import { describe, expect, it } from "vitest";
import type { AgentFactory, SubAgentSpawnOptions } from "./agentFactory.js";
import { defaultPermissionPolicy } from "./permissions.js";
import { runSubAgent, runSubAgents } from "./subagents.js";
import type { AgentEvent, TurnTrace } from "./types.js";

const provider = new MockProvider();
const root = "/tmp/ninjacode-subagent-tests";

function options(createAgent: AgentFactory) {
  return {
    createAgent,
    provider,
    workspaceRoot: root,
    agentDir: `${root}/.ninjacode`,
  };
}

function delayedFactory(onActive: (delta: number) => void): AgentFactory {
  return () => ({
    async run(task) {
      onActive(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      onActive(-1);
      return { answer: task, completed: true };
    },
  });
}

describe("sub-agent governance", () => {
  it("limits concurrent children", async () => {
    let active = 0;
    let peak = 0;
    const createAgent = delayedFactory((delta) => {
      active += delta;
      peak = Math.max(peak, active);
    });

    const results = await runSubAgents({
      ...options(createAgent),
      tasks: ["one", "two", "three", "four"],
      governance: { maxConcurrency: 2 },
    });

    expect(results).toHaveLength(4);
    expect(peak).toBe(2);
  });

  it("serializes writing roles even when general concurrency is higher", async () => {
    let active = 0;
    let peak = 0;
    const createAgent = delayedFactory((delta) => {
      active += delta;
      peak = Math.max(peak, active);
    });

    await runSubAgents({
      ...options(createAgent),
      tasks: ["edit one", "edit two", "edit three"],
      role: "fast_edit",
      governance: { maxConcurrency: 3 },
    });

    expect(peak).toBe(1);
  });

  it("passes per-child limits and explicit inherited security settings", async () => {
    let spawned: SubAgentSpawnOptions | undefined;
    const createAgent: AgentFactory = (childOptions) => {
      spawned = childOptions;
      return { run: async () => ({ answer: "done", completed: true }) };
    };

    await runSubAgent({
      ...options(createAgent),
      task: "edit safely",
      role: "fast_edit",
      maxTurns: 3,
      maxCostUsd: 0.1,
      timeoutMs: 250,
      sandboxMode: "workspace-write",
      permissionPolicy: defaultPermissionPolicy("strict"),
    });

    expect(spawned).toMatchObject({
      maxTurns: 3,
      runTimeoutMs: 250,
      budget: { maxCostUsd: 0.1 },
      sandboxMode: "workspace-write",
      enableSubagents: false,
    });
    expect(spawned?.permissions.getPolicy().mode).toBe("strict");
  });

  it("propagates abort to a running child", async () => {
    const controller = new AbortController();
    let childSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const createAgent: AgentFactory = (childOptions) => ({
      run: async () => {
        childSignal = childOptions.signal;
        markStarted?.();
        return new Promise((_, reject) => {
          const fail = () => reject(new DOMException("stopped", "AbortError"));
          if (childOptions.signal?.aborted) fail();
          else childOptions.signal?.addEventListener("abort", fail, { once: true });
        });
      },
    });

    const pending = runSubAgent({
      ...options(createAgent),
      task: "wait",
      signal: controller.signal,
    });
    await started;
    controller.abort("parent stopped");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(childSignal).toBe(controller.signal);
  });

  it("returns structured evidence, artifacts, changed files, tests and lifecycle events", async () => {
    const events: AgentEvent[] = [];
    const turns: TurnTrace[] = [
      {
        turn: 1,
        assistantText: "",
        usage: { inputTokens: 1, outputTokens: 1 },
        toolInvocations: [
          {
            toolCall: { id: "read", name: "read_file", arguments: { path: "src/a.ts" } },
            output: "source evidence",
            approved: true,
            durationMs: 1,
            artifactId: "artifact-read",
          },
          {
            toolCall: { id: "edit", name: "apply_patch", arguments: {} },
            output: "patched",
            approved: true,
            durationMs: 1,
            meta: { paths: ["src/a.ts"] },
          },
          {
            toolCall: { id: "test", name: "run_shell", arguments: { command: "pnpm test" } },
            output: "all tests passed",
            approved: true,
            durationMs: 1,
          },
        ],
      },
    ];
    const createAgent: AgentFactory = (childOptions) => ({
      run: async () => {
        await childOptions.onEvent?.({ type: "status", payload: { message: "working" } });
        return { answer: "implemented", completed: true, turns };
      },
    });

    const result = await runSubAgent({
      ...options(createAgent),
      task: "change it",
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(result).toMatchObject({
      summary: "implemented",
      completed: true,
      changedFiles: ["src/a.ts"],
      artifacts: [{ id: "artifact-read", tool: "read_file" }],
      tests: [{ command: "pnpm test", passed: true, output: "all tests passed" }],
    });
    expect(result.evidence.map((item) => item.tool)).toEqual([
      "read_file",
      "apply_patch",
      "run_shell",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "subagent_start",
      "subagent_progress",
      "status",
      "subagent_end",
    ]);
  });
});
