import type { PersistedSession } from "./sessions.js";
import { normalizeToolHistory } from "./toolHistory.js";
import type { AgentConfig, AgentRuntime } from "./agentState.js";

export function applySavedSession(
  runtime: AgentRuntime,
  config: AgentConfig,
  saved: PersistedSession,
): void {
  runtime.history = normalizeToolHistory(saved.history);
  runtime.turns = saved.turns;
  runtime.pinnedTask = saved.pinnedTask;
  config.createdAt = saved.config.createdAt;
  runtime.requests = saved.requests ? [...saved.requests] : [];
  if (saved.config.planId) runtime.planId = saved.config.planId;
  runtime.globalTurn = saved.turns.reduce((max, t) => Math.max(max, t.turn + 1), 0);
  for (const g of saved.grants) {
    const idx = g.indexOf(":");
    if (idx === -1) continue;
    config.permissions.grant(g.slice(0, idx), g.slice(idx + 1));
  }
}
