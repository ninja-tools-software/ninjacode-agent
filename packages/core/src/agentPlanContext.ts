import fs from "node:fs/promises";
import path from "node:path";
import { readPlan, stripPlanHeader } from "@ninjacode/tools";
import { buildSystemPrompt } from "./rules.js";
import type { AgentMode } from "./types.js";
import type { SkillDefinition } from "./skills.js";

export async function readAgentScratchpad(agentDir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(agentDir, "scratchpad.md"), "utf8");
  } catch {
    return "";
  }
}

export async function readAgentActivePlan(agentDir: string, planId: string): Promise<string> {
  const record = await readPlan(agentDir, planId);
  return record ? stripPlanHeader(record.content).trim() : "";
}

export async function buildAgentSystemPrompt(opts: {
  mode: AgentMode;
  workspaceRoot: string;
  agentDir: string;
  skills: SkillDefinition[];
  rules: string;
  debugLogUrl?: string;
}): Promise<string> {
  return buildSystemPrompt({
    mode: opts.mode,
    workspaceRoot: opts.workspaceRoot,
    rules: opts.rules,
    debugLogUrl: opts.debugLogUrl,
    agentDir: opts.agentDir,
    skills: opts.skills.map((s) => ({ name: s.name, description: s.description })),
  });
}
