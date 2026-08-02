import { describe, expect, it } from "vitest";
import { mapPool, runBench } from "./runner.js";
import type { AgentAdapter, BenchTask } from "./types.js";

describe("mapPool", () => {
  it("preserves order with concurrency > 1", async () => {
    const delays = [30, 5, 15, 1];
    const started: number[] = [];
    const out = await mapPool(delays, 2, async (ms, index) => {
      started.push(index);
      await new Promise((r) => setTimeout(r, ms));
      return index * 10;
    });
    expect(out).toEqual([0, 10, 20, 30]);
    expect(started.length).toBe(4);
  });

  it("runs at most concurrency items at once", async () => {
    let inflight = 0;
    let maxInflight = 0;
    await mapPool([1, 2, 3, 4, 5], 2, async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
    });
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxInflight).toBe(2);
  });

  it("returns empty for empty input", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});

describe("runBench concurrency", () => {
  it("runs jobs concurrently when concurrency > 1", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const agent: AgentAdapter = {
      name: "fake",
      async run() {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 40));
        inflight -= 1;
        return {
          metrics: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
          outputTail: "",
          // Force verify path to be skipped via agent_error so we don't need fixtures.
          agentError: "skip",
        };
      },
    };
    const tasks: BenchTask[] = [
      { id: "t1", description: "", category: "fix", difficulty: "easy", prompt: "", verify: "true" },
      { id: "t2", description: "", category: "fix", difficulty: "easy", prompt: "", verify: "true" },
      { id: "t3", description: "", category: "fix", difficulty: "easy", prompt: "", verify: "true" },
    ];
    const report = await runBench([agent], tasks, { trials: 1, concurrency: 3 });
    expect(report.results).toHaveLength(3);
    expect(maxInflight).toBe(3);
    expect(report.results.every((r) => r.failureKind === "agent_error")).toBe(true);
  });
});
