import { resolveModelPricing, type TokenUsage, type ToolSpec } from "@ninjacode/providers";
import type { Message } from "@ninjacode/providers";
import { estimateContextUsage, type ContextUsageBreakdown } from "./contextEstimate.js";
import type { BudgetTracker } from "./reliability.js";
import type { AgentStopReason } from "./types.js";

export function linkExternalAbortSignal(
  externalSignal: AbortSignal | undefined,
  controller: AbortController,
  abort: (reason?: unknown) => void,
): void {
  if (!externalSignal) return;
  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason);
    return;
  }
  externalSignal.addEventListener("abort", () => abort(externalSignal.reason), { once: true });
}

export function isAbortError(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export function waitOrAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException(String(signal.reason ?? "Aborted"), "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException(String(signal.reason ?? "Aborted"), "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Milliseconds left on the run clock; `Infinity` when the run is untimed. */
export function remainingRunMs(runTimeoutMs: number, runStartedAt: number): number {
  if (!runTimeoutMs || runTimeoutMs <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, runTimeoutMs - (Date.now() - runStartedAt));
}

export function checkRunTimeout(runTimeoutMs: number, runStartedAt: number): string | undefined {
  if (!runTimeoutMs || runTimeoutMs <= 0) return undefined;
  if (Date.now() - runStartedAt > runTimeoutMs) {
    return `Run timeout exceeded (${Math.round(runTimeoutMs / 1000)}s).`;
  }
  return undefined;
}

export function isTimeoutAbortReason(reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === "TimeoutError") return true;
  if (reason instanceof Error && reason.name === "TimeoutError") return true;
  const message =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return /run timeout exceeded/i.test(message);
}

export function abortReasonMessage(
  signal: AbortSignal,
  fallback = "Aborted by user.",
): string {
  const reason = signal.reason;
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason;
  return fallback;
}

export function classifyAgentStopReason(opts: {
  completed: boolean;
  aborted: boolean;
  abortReason?: unknown;
  answer?: string;
}): AgentStopReason {
  if (opts.completed) return "completed";
  if (isTimeoutAbortReason(opts.abortReason) || /run timeout exceeded/i.test(opts.answer ?? "")) {
    return "timeout";
  }
  if (opts.aborted) return "aborted";
  return "incomplete";
}

export function trackTokenUsage(
  budget: BudgetTracker,
  cacheStats: { cacheReadTokens: number; cacheWriteTokens: number },
  usage: TokenUsage,
  opts: { category?: "compaction"; model?: string; durationMs?: number } = {},
): void {
  budget.add(usage, {
    category: opts.category,
    pricing: opts.model ? resolveModelPricing(opts.model) : undefined,
    model: opts.model,
    durationMs: opts.durationMs,
  });
  cacheStats.cacheReadTokens += usage.cacheReadTokens ?? 0;
  cacheStats.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
}

export function estimateAgentUsage(opts: {
  system: string;
  history: Message[];
  toolSpecs: ToolSpec[];
  contextWindow?: number;
  maxTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model?: string;
}): ContextUsageBreakdown {
  return estimateContextUsage({
    system: opts.system,
    history: opts.history,
    tools: opts.toolSpecs,
    window: opts.contextWindow,
    reservedOutput: opts.maxTokens,
    cacheReadTokens: opts.cacheReadTokens,
    cacheWriteTokens: opts.cacheWriteTokens,
    model: opts.model,
  });
}
