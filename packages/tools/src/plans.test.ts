import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deletePlan,
  listPlans,
  parsePlanHeader,
  planIdForSession,
  readPlan,
  renamePlanTitle,
  slugifyTitle,
  writePlan,
} from "./plans.js";

describe("plans store", () => {
  let agentDir: string;

  beforeEach(async () => {
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-plans-"));
  });

  afterEach(async () => {
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("derives stable plan ids from session", () => {
    expect(planIdForSession(sessionId)).toHaveLength(8);
    expect(planIdForSession(sessionId)).toBe(planIdForSession(sessionId));
  });

  it("slugifies titles for filenames", () => {
    expect(slugifyTitle("Plan d'exemple démo")).toBe("plan-d-exemple-demo");
    expect(slugifyTitle("!!!")).toBe("plan");
  });

  it("creates a plan file with metadata header", async () => {
    const planId = planIdForSession(sessionId);
    const record = await writePlan(agentDir, {
      planId,
      sessionId,
      title: "My Plan",
      content: "## Context\n\nHello",
    });
    expect(record.relPath).toMatch(/\.ninjacode\/plans\/my-plan_/);
    expect(record.relPath).toContain(`${planId}.plan.md`);
    const header = parsePlanHeader(record.content);
    expect(header?.id).toBe(planId);
    expect(header?.sessionId).toBe(sessionId);
    expect(header?.title).toBe("My Plan");
  });

  it("updates the same file on revision (no duplicate)", async () => {
    const planId = planIdForSession(sessionId);
    const first = await writePlan(agentDir, {
      planId,
      sessionId,
      title: "First title",
      content: "Body v1",
    });
    const second = await writePlan(agentDir, {
      planId,
      sessionId,
      title: "Revised title",
      content: "Body v2",
    });
    expect(path.basename(first.file)).toBe(path.basename(second.file));
    const listedAfter = await listPlans(agentDir);
    expect(listedAfter).toHaveLength(1);
    expect(listedAfter[0]?.title).toBe("Revised title");
  });

  it("lists plans with preview text", async () => {
    const planId = planIdForSession(sessionId);
    await writePlan(agentDir, {
      planId,
      sessionId,
      title: "Listed",
      content: "Preview body content here",
    });
    const items = await listPlans(agentDir);
    expect(items).toHaveLength(1);
    expect(items[0]?.preview).toContain("Preview body");
  });

  it("reads plan by id", async () => {
    const planId = planIdForSession(sessionId);
    await writePlan(agentDir, {
      planId,
      sessionId,
      title: "Read me",
      content: "Stored",
    });
    const plan = await readPlan(agentDir, planId);
    expect(plan?.title).toBe("Read me");
    expect(plan?.content).toContain("Stored");
  });

  it("renames title without changing filename", async () => {
    const planId = planIdForSession(sessionId);
    const created = await writePlan(agentDir, {
      planId,
      sessionId,
      title: "Old",
      content: "X",
    });
    const renamed = await renamePlanTitle(agentDir, planId, "New title");
    expect(path.basename(created.file)).toBe(path.basename(renamed!.file));
    expect(renamed?.title).toBe("New title");
    expect(renamed?.content).toContain("# New title");
  });

  it("deletes a plan", async () => {
    const planId = planIdForSession(sessionId);
    await writePlan(agentDir, { planId, sessionId, title: "Del", content: "x" });
    expect(await deletePlan(agentDir, planId)).toBe(true);
    expect(await readPlan(agentDir, planId)).toBeNull();
  });

  it("parses files without header using content title", async () => {
    const dir = path.join(agentDir, "plans");
    await fs.mkdir(dir, { recursive: true });
    const planId = planIdForSession(sessionId);
    const file = path.join(dir, `legacy_${planId}.plan.md`);
    await fs.writeFile(file, "# Legacy title\n\nBody", "utf8");
    const plan = await readPlan(agentDir, planId);
    expect(plan?.title).toBe("Legacy title");
  });

  it("strips task sync markers for display", async () => {
    const { planContentForDisplay } = await import("./plans.js");
    const raw = [
      "# Plan",
      "",
      "Body",
      "",
      "<!-- ninjacode:tasks:start -->",
      "## Tasks",
      "- [ ] One",
      "<!-- ninjacode:tasks:end -->",
    ].join("\n");
    const shown = planContentForDisplay(raw);
    expect(shown).not.toContain("ninjacode:tasks");
    expect(shown).toContain("## Tasks");
    expect(shown).toContain("- [ ] One");
  });

});
