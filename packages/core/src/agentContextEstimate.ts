import type { Message } from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";
import {
  compactHistoryLossless,
  estimateContextUsage,
  type ContextUsageBreakdown,
} from "./context.js";
import { filterToolsForEditFormat, preferredEditFormat } from "./editTools.js";
import { buildSystemPrompt, discoverRules } from "./rules.js";
import { discoverSkills, enabledSkills } from "./skills.js";
import type { AgentMode } from "./types.js";

/** Estimate context usage for a persisted or in-flight session without running the agent. */
export async function estimateContextForSession(opts: {
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  history: Message[];
  tools: ToolRegistry;
  contextWindow?: number;
  maxTokens?: number;
  providerKind?: string;
  model?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Promise<ContextUsageBreakdown> {
  const rules = await discoverRules(opts.workspaceRoot)
    .then((r) => r.text)
    .catch(() => "");
  const skills = enabledSkills(await discoverSkills(opts.workspaceRoot).catch(() => []));
  const system = buildSystemPrompt({
    mode: opts.mode,
    workspaceRoot: opts.workspaceRoot,
    rules,
    agentDir: opts.agentDir,
    skills: skills.map((s) => ({ name: s.name, description: s.description })),
  });
  const editFormat = preferredEditFormat(opts.providerKind, opts.model);
  const toolSpecs = filterToolsForEditFormat(opts.tools.forMode(opts.mode), editFormat).specs();
  const history = compactHistoryLossless(opts.history.filter((m) => m.role !== "system"));
  return estimateContextUsage({
    system,
    history,
    tools: toolSpecs,
    window: opts.contextWindow,
    reservedOutput: opts.maxTokens,
    cacheReadTokens: opts.cacheReadTokens,
    cacheWriteTokens: opts.cacheWriteTokens,
  });
}
