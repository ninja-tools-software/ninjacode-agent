import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writePlanTool } from "./plan.js";
import { listPlans, planIdForSession } from "./plans.js";
import type { ToolContext } from "./types.js";

describe("write_plan tool", () => {
  let agentDir: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-write-plan-"));
    const sessionId = "11111111-2222-3333-4444-555555555555";
    ctx = {
      workspaceRoot: agentDir,
      agentDir,
      sessionId,
      planId: planIdForSession(sessionId),
    };
  });

  afterEach(async () => {
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  it("documents that PLAN mode ends the run after a successful write", () => {
    expect(writePlanTool.description).toMatch(/harness ends the run/i);
  });

  it("writes a plan file under .ninjacode/plans", async () => {
    const result = await writePlanTool.execute(ctx, {
      title: "Feature plan",
      content: "## Steps\n\n1. Do thing",
    });
    expect(result.output).toContain("Feature plan");
    expect(result.meta?.created).toBe(true);
    const items = await listPlans(agentDir);
    expect(items).toHaveLength(1);
  });

  it("overwrites on second call (no duplicate files)", async () => {
    await writePlanTool.execute(ctx, { title: "V1", content: "first" });
    const second = await writePlanTool.execute(ctx, { title: "V2", content: "second" });
    expect(second.meta?.created).toBe(false);
    expect(await listPlans(agentDir)).toHaveLength(1);
  });

  it("requires session id", async () => {
    await expect(
      writePlanTool.execute({ ...ctx, sessionId: undefined }, { title: "X", content: "y" }),
    ).rejects.toThrow(/session/i);
  });
});
