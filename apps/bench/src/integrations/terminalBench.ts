/**
 * Terminal-Bench 2.1 / Harbor adapter.
 *
 * Large live runs stay manual. This module maps a Harbor/Terminal-Bench
 * instruction file into a NinjaBench task so canaries stay reproducible.
 */
import type { BenchTask } from "../types.js";

export interface TerminalBenchInstruction {
  id: string;
  instruction: string;
  verify: string;
  timeoutSec?: number;
}

export function toNinjaBenchTask(instruction: TerminalBenchInstruction): BenchTask {
  return {
    id: `tb-${instruction.id}`,
    description: `Terminal-Bench canary: ${instruction.id}`,
    category: "terminal",
    difficulty: "medium",
    suites: ["canary", "terminal-bench"],
    prompt: instruction.instruction,
    verify: instruction.verify,
    timeoutSec: instruction.timeoutSec ?? 300,
  };
}

export const TERMINAL_BENCH_CANARY: TerminalBenchInstruction = {
  id: "echo-ok",
  instruction: "Create a file named result.txt containing exactly: ok",
  verify: "test \"$(cat result.txt)\" = ok",
};
