import { useMemo } from "react";
import { lastIndexOfKind, liveIndex } from "../state/chatReducer.js";
import type { LogItem } from "../types.js";
import {
  lastWritePlanIndex,
  planBlockSummaryIndices,
  planBlockTodoWriteIndex,
} from "./planCardMarks.js";

function lastTodoWriteIndex(log: LogItem[]): number {
  for (let i = log.length - 1; i >= 0; i--) {
    const it = log[i];
    if (it?.kind === "tool" && it.name === "todo_write") return i;
  }
  return -1;
}

export interface LogMarks {
  lastUser: number;
  lastAssistant: number;
  lastTodoWrite: number;
  lastWritePlan: number;
  planSummaries: number[];
  planBlockTodoWrite: number;
  planSummarySet: Set<number>;
  liveStatus: number;
  liveReasoning: number;
}

export function useLogMarks(log: LogItem[], agentActive: boolean): LogMarks {
  return useMemo(() => {
    const lastUser = lastIndexOfKind(log, "user");
    const lastWritePlan = lastWritePlanIndex(log);
    const planSummaries = planBlockSummaryIndices(log, lastWritePlan);
    return {
      lastUser,
      lastAssistant: lastIndexOfKind(log, "assistant"),
      lastTodoWrite: lastTodoWriteIndex(log),
      lastWritePlan,
      planSummaries,
      planBlockTodoWrite: planBlockTodoWriteIndex(log, lastWritePlan),
      planSummarySet: new Set(planSummaries),
      liveStatus: liveIndex(log, "status", lastUser, agentActive),
      liveReasoning: liveIndex(log, "reasoning", lastUser, agentActive),
    };
  }, [log, agentActive]);
}
