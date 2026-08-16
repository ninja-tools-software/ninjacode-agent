import type { CloudJobV1 } from "./contract.js";

export function testJob(
  id = "job-1",
  overrides: Partial<CloudJobV1> = {},
): CloudJobV1 {
  return {
    version: 1,
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    task: { prompt: "Do the work" },
    workspace: { kind: "empty" },
    execution: {
      maxAttempts: 3,
      leaseMs: 10_000,
      heartbeatMs: 1_000,
      timeoutMs: 5_000,
      retry: { baseDelayMs: 100, maxDelayMs: 1_000 },
    },
    ...overrides,
  };
}
