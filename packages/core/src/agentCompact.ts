import type { LlmProvider, Message } from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";
import { compactHistory, estimateContextUsage, type ContextUsageBreakdown } from "./context.js";
import { buildSystemPrompt, discoverRules } from "./rules.js";
import type { AgentMode } from "./types.js";
import type { SkillDefinition } from "./skills.js";

export async function compactAgentHistory(opts: {
  history: Message[];
  pinnedTask?: string;
  provider: LlmProvider;
  model?: string;
  contextWindow?: number;
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  skills: SkillDefinition[];
  tools: ToolRegistry;
  maxTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  onCompaction: (info: import("./context.js").CompactionInfo) => void | Promise<void>;
  onUsage: (usage: ContextUsageBreakdown) => void | Promise<void>;
}): Promise<{ compacted: Message[]; usage: ContextUsageBreakdown } | null> {
  if (opts.history.length === 0) return null;

  const compacted = await compactHistory({
    history: opts.history,
    pinnedTask: opts.pinnedTask,
    provider: opts.provider,
    model: opts.model,
    contextWindow: opts.contextWindow,
    force: true,
    onCompaction: opts.onCompaction,
  });

  const rules = await discoverRules(opts.workspaceRoot).then((r) => r.text).catch(() => "");
  const system = buildSystemPrompt({
    mode: opts.mode,
    workspaceRoot: opts.workspaceRoot,
    rules,
    agentDir: opts.agentDir,
    skills: opts.skills.map((s) => ({ name: s.name, description: s.description })),
  });
  const toolSpecs = opts.tools.forMode(opts.mode).specs();
  const usage = estimateContextUsage({
    system,
    history: compacted,
    tools: toolSpecs,
    window: opts.contextWindow,
    reservedOutput: opts.maxTokens,
    cacheReadTokens: opts.cacheReadTokens,
    cacheWriteTokens: opts.cacheWriteTokens,
  });
  await opts.onUsage(usage);
  return { compacted, usage };
}
