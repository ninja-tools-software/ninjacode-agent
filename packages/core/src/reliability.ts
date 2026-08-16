import type {
  Completion,
  CompletionRequest,
  LlmProvider,
  ModelPricing,
  StreamSink,
} from "@ninjacode/providers";
import { GatewayError, isTerminalGatewayCode, LlmError } from "@ninjacode/providers";
import { nodeClock } from "./nodePorts.js";
import type { Clock } from "./ports.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  clock?: Clock;
  /** Override delay for tests; defaults to real timer-based sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const RETRY_WRAPPED_PROVIDERS = new WeakSet<LlmProvider>();
const MAX_PROVIDER_RETRIES = 5;

/**
 * Wrap any LlmProvider with exponential backoff on 429 / 5xx / network errors.
 */
export function withRetry(provider: LlmProvider, opts: RetryOptions = {}): LlmProvider {
  const maxRetries = boundedInteger(opts.maxRetries, 4, 0, MAX_PROVIDER_RETRIES);
  const baseDelayMs = boundedInteger(opts.baseDelayMs, 500, 0, 60_000);
  const maxDelayMs = boundedInteger(opts.maxDelayMs, 16_000, baseDelayMs, 60_000);
  const clock = opts.clock ?? nodeClock;
  const sleepFn = opts.sleep ?? sleep;

  const wrapped: LlmProvider = {
    name: `${provider.name}+retry`,
    async complete(req: CompletionRequest): Promise<Completion> {
      return retry({
        fn: () => provider.complete(req),
        maxRetries,
        baseDelayMs,
        maxDelayMs,
        signal: req.signal,
        clock,
        sleepFn,
      });
    },
    async completeStreaming(req: CompletionRequest, sink?: StreamSink): Promise<Completion> {
      // Retrying after deltas reached the sink would replay them: the user would
      // see the start of the answer twice. Once text is out, the attempt is final.
      let emitted = false;
      const guarded: StreamSink | undefined = sink
        ? async (event) => {
            emitted = true;
            await sink(event);
          }
        : undefined;

      return retry({
        fn: () => provider.completeStreaming(req, guarded),
        canRetry: () => !emitted,
        maxRetries,
        baseDelayMs,
        maxDelayMs,
        signal: req.signal,
        clock,
        sleepFn,
      });
    },
  };
  RETRY_WRAPPED_PROVIDERS.add(wrapped);
  return wrapped;
}

/** Outer turn retries must not stack on this wrapper's own bounded retry loop. */
export function isRetryWrappedProvider(provider: LlmProvider): boolean {
  return RETRY_WRAPPED_PROVIDERS.has(provider);
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function retry<T>(opts: {
  fn: () => Promise<T>;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal?: AbortSignal;
  clock: Clock;
  sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Extra veto on top of retryability, e.g. "output already streamed". */
  canRetry?: () => boolean;
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    try {
      return await opts.fn();
    } catch (e) {
      lastError = e;
      if (isAbortError(e)) throw e;
      if (opts.signal?.aborted) throw abortError(opts.signal);
      if (opts.canRetry?.() === false) throw e;
      if (!isRetryableLlmError(e) || attempt === opts.maxRetries) throw e;
      const delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
      const jitter = backoffJitter(opts.clock, attempt, delay);
      await opts.sleepFn(delay + jitter, opts.signal);
    }
  }
  throw lastError;
}

/** Deterministic 0–20% jitter derived from clock + attempt (testable via a fake clock). */
function backoffJitter(clock: Clock, attempt: number, delay: number): number {
  const fraction = ((clock.now() + attempt * 7919) % 1000) / 1000;
  return fraction * delay * 0.2;
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

function abortError(signal: AbortSignal): Error {
  return new DOMException(signal.reason ? String(signal.reason) : "Aborted", "AbortError");
}

export function isRetryableLlmError(e: unknown): boolean {
  if (e instanceof GatewayError) return !e.partial && !isTerminalGatewayCode(e.code);
  if (e instanceof LlmError) {
    if (e.status === 429) return true;
    if (e.status && e.status >= 500) return true;
  }
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("socket") ||
    msg.includes("429") ||
    msg.includes("rate limit")
  );
}

/** Abort-aware backoff; cancellation is surfaced as a typed AbortError. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

/** How long a tripped tool stays fully blocked before one probe is allowed. */
const BREAKER_COOLDOWN_MS = 60_000;

/**
 * Circuit breaker per tool: after N consecutive failures the tool is blocked,
 * then half-opens after a cooldown so a transient cause (a missing dependency
 * the agent has since installed) does not disable it for the whole session.
 */
export class ToolCircuitBreaker {
  private readonly fails = new Map<string, number>();
  private readonly openedAt = new Map<string, number>();
  private readonly probing = new Set<string>();
  private readonly clock: Clock;
  private readonly cooldownMs: number;

  constructor(
    private readonly threshold = 3,
    opts: { clock?: Clock; cooldownMs?: number } = {},
  ) {
    this.clock = opts.clock ?? nodeClock;
    this.cooldownMs = opts.cooldownMs ?? BREAKER_COOLDOWN_MS;
  }

  /** Half-opening is a state change, so asking the question can let one call through. */
  isOpen(toolName: string): boolean {
    if (this.isBlocked(toolName)) return true;
    if (this.openedAt.has(toolName)) this.probing.add(toolName);
    return false;
  }

  private isBlocked(toolName: string): boolean {
    const openedAt = this.openedAt.get(toolName);
    return openedAt !== undefined && this.clock.now() - openedAt < this.cooldownMs;
  }

  recordSuccess(toolName: string): void {
    this.fails.delete(toolName);
    this.openedAt.delete(toolName);
    this.probing.delete(toolName);
  }

  recordFailure(toolName: string): void {
    if (this.probing.delete(toolName)) {
      this.openedAt.set(toolName, this.clock.now());
      return;
    }
    const n = (this.fails.get(toolName) ?? 0) + 1;
    this.fails.set(toolName, n);
    if (n >= this.threshold) this.openedAt.set(toolName, this.clock.now());
  }

  reset(toolName?: string): void {
    if (toolName) {
      this.fails.delete(toolName);
      this.openedAt.delete(toolName);
      this.probing.delete(toolName);
    } else {
      this.fails.clear();
      this.openedAt.clear();
      this.probing.clear();
    }
  }

  /** Tools currently blocked — a half-open tool is not one of them. */
  disabledTools(): string[] {
    return [...this.openedAt.keys()].filter((name) => this.isBlocked(name));
  }
}

export interface SessionBudget {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  /** Soft USD estimate budget (list-price heuristic). */
  maxCostUsd?: number;
}

/** Used when a price table omits cache lines: Anthropic's ratios to input price. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export class BudgetTracker {
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  cacheWriteTokens = 0;
  estimatedCostUsd = 0;
  compactionInputTokens = 0;
  compactionOutputTokens = 0;
  compactionCacheReadTokens = 0;
  compactionCacheWriteTokens = 0;
  compactionEstimatedCostUsd = 0;
  compactionCount = 0;
  compactionDurationMs = 0;
  compactionModel?: string;

  /**
   * `pricing` must be the price table of the model actually being called: a run
   * priced at another model's rate makes the cost ceiling meaningless — twenty
   * times too strict on a cheap model, far too loose on an expensive one.
   */
  constructor(
    private readonly budget: SessionBudget = {},
    private readonly pricing: ModelPricing = { input: 3, output: 15 },
  ) {}

  /**
   * `TokenUsage` buckets are disjoint (uncached input / cache read / cache
   * write), so each is priced on its own — subtracting cache reads from input
   * would zero out the bill exactly when caching works.
   */
  add(usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }, opts: {
    category?: "compaction";
    pricing?: ModelPricing;
    durationMs?: number;
    model?: string;
  } = {}): void {
    const p = opts.pricing ?? this.pricing;
    const cacheReadPrice = p.cacheRead ?? p.input * CACHE_READ_MULTIPLIER;
    const cacheWritePrice = p.cacheWrite ?? p.input * CACHE_WRITE_MULTIPLIER;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheWrite = usage.cacheWriteTokens ?? 0;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.cacheReadTokens += cacheRead;
    this.cacheWriteTokens += cacheWrite;
    const cost =
      (usage.inputTokens / 1e6) * p.input +
      (cacheRead / 1e6) * cacheReadPrice +
      (cacheWrite / 1e6) * cacheWritePrice +
      (usage.outputTokens / 1e6) * p.output;
    this.estimatedCostUsd += cost;
    if (opts.category === "compaction") {
      this.compactionInputTokens += usage.inputTokens;
      this.compactionOutputTokens += usage.outputTokens;
      this.compactionCacheReadTokens += cacheRead;
      this.compactionCacheWriteTokens += cacheWrite;
      this.compactionEstimatedCostUsd += cost;
      this.compactionCount += 1;
      this.compactionDurationMs += opts.durationMs ?? 0;
      this.compactionModel = opts.model ?? this.compactionModel;
    }
  }

  check(): { ok: boolean; reason?: string } {
    const b = this.budget;
    if (b.maxInputTokens != null && this.inputTokens >= b.maxInputTokens) {
      return { ok: false, reason: `input token budget exceeded (${this.inputTokens})` };
    }
    if (b.maxOutputTokens != null && this.outputTokens >= b.maxOutputTokens) {
      return { ok: false, reason: `output token budget exceeded (${this.outputTokens})` };
    }
    const total = this.inputTokens + this.outputTokens;
    if (b.maxTotalTokens != null && total >= b.maxTotalTokens) {
      return { ok: false, reason: `total token budget exceeded (${total})` };
    }
    if (b.maxCostUsd != null && this.estimatedCostUsd >= b.maxCostUsd) {
      return {
        ok: false,
        reason: `cost budget exceeded (~$${this.estimatedCostUsd.toFixed(4)})`,
      };
    }
    return { ok: true };
  }

  snapshot() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      estimatedCostUsd: this.estimatedCostUsd,
      compaction: {
        inputTokens: this.compactionInputTokens,
        outputTokens: this.compactionOutputTokens,
        cacheReadTokens: this.compactionCacheReadTokens,
        cacheWriteTokens: this.compactionCacheWriteTokens,
        estimatedCostUsd: this.compactionEstimatedCostUsd,
        count: this.compactionCount,
        durationMs: this.compactionDurationMs,
        model: this.compactionModel,
      },
    };
  }
}
