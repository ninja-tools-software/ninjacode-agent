import { describe, expect, it } from "vitest";
import { parseCloudJobV1 } from "./contract.js";
import { testJob } from "./testHelpers.js";

describe("parseCloudJobV1", () => {
  it("accepts the versioned v1 contract", () => {
    expect(parseCloudJobV1(testJob())).toMatchObject({
      version: 1,
      id: "job-1",
      workspace: { kind: "empty" },
    });
  });

  it("rejects an unknown version", () => {
    expect(() => parseCloudJobV1({ ...testJob(), version: 2 })).toThrow(
      "unsupported job version",
    );
  });

  it("bounds retries and requires heartbeat shorter than lease", () => {
    const job = testJob();
    expect(() =>
      parseCloudJobV1({
        ...job,
        execution: { ...job.execution, maxAttempts: 11 },
      }),
    ).toThrow("execution.maxAttempts");
    expect(() =>
      parseCloudJobV1({
        ...job,
        execution: {
          ...job.execution,
          heartbeatMs: job.execution.leaseMs,
        },
      }),
    ).toThrow("heartbeatMs");
  });
});
