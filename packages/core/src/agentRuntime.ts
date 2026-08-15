import { resolveModelPricing, type TokenUsage, type ToolSpec } from "@ninjacode/providers";
import type { Message } from "@ninjacode/providers";
import { estimateContextUsage, type ContextUsageBreakdown } from "./contextEstimate.js";
import type { BudgetTracker } from "./reliability.js";

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

export function checkRunTimeout(runTimeoutMs: number, runStartedAt: number): string | undefined {
  if (!runTimeoutMs || runTimeoutMs <= 0) return undefined;
  if (Date.now() - runStartedAt > runTimeoutMs) {
    return `Run timeout exceeded (${Math.round(runTimeoutMs / 1000)}s).`;
  }
  return undefined;
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
