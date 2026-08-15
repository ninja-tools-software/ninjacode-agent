/**
 * ProgramBench adapter — maps a hidden-test programming task into NinjaBench.
 */
import type { BenchTask } from "../types.js";

export interface ProgramBenchTask {
  id: string;
  prompt: string;
  verify: string;
}

export function toNinjaBenchTask(task: ProgramBenchTask): BenchTask {
  return {
    id: `pb-${task.id}`,
    description: `ProgramBench canary: ${task.id}`,
    category: "feature",
    difficulty: "easy",
    suites: ["canary", "program-bench"],
    prompt: task.prompt,
    verify: task.verify,
    timeoutSec: 180,
  };
}

export const PROGRAM_BENCH_CANARY: ProgramBenchTask = {
  id: "add-two",
  prompt: "Write add.js exporting add(a, b) that returns a + b.",
  verify: "node -e \"const {add}=require('./add.js'); if (add(2,3)!==5) process.exit(1)\"",
};
