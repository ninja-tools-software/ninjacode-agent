/**
 * Bounds a single LLM request in time. A provider that answers slowly is normal;
 * one that never answers must not be allowed to spend the whole run budget
 * waiting for it, and retrying such a request forever is the same waste spread
 * over more turns.
 */

export interface LlmTurnStallOptions {
  /** Ceiling for one LLM request. Also capped by the remaining run budget. */
  requestTimeoutMs?: number;
  /** Abort a request that produced no stream event at all for this long. */
  streamIdleTimeoutMs?: number;
  /** Consecutive stalled turns tolerated before the run ends. */
  maxConsecutiveStalls?: number;
}

export interface ResolvedLlmTurnStallOptions {
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  maxConsecutiveStalls: number;
}

/**
 * Generous enough for extended thinking at the highest reasoning efforts, and
 * deliberately not higher: undici caps time-to-headers at 300s and Node's
 * global `fetch` exposes no way to raise it, so a larger ceiling here would
 * never be reached — the socket would die first and surface as an opaque
 * `fetch failed` instead of a clean stall.
 */
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
/** Silence this long means the stream is dead, not thinking. */
export const DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_CONSECUTIVE_STALLS = 2;
/** Floor so a request started near the end of the run still gets a real chance. */
const MIN_EFFECTIVE_REQUEST_TIMEOUT_MS = 10_000;

function bounded(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  return Math.max(minimum, Math.floor(value));
}

export function resolveLlmTurnStallOptions(
  options: LlmTurnStallOptions = {},
): ResolvedLlmTurnStallOptions {
  return {
    requestTimeoutMs: bounded(options.requestTimeoutMs, DEFAULT_LLM_REQUEST_TIMEOUT_MS, 1_000),
    streamIdleTimeoutMs: bounded(
      options.streamIdleTimeoutMs,
      DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS,
      1_000,
    ),
    maxConsecutiveStalls: Math.max(
      1,
      Math.floor(
        Number.isFinite(options.maxConsecutiveStalls)
          ? (options.maxConsecutiveStalls as number)
          : DEFAULT_MAX_CONSECUTIVE_STALLS,
      ),
    ),
  };
}

/**
 * Waiting past the end of the run guarantees the wait is wasted, so the ceiling
 * for one request is the configured one narrowed by what the run has left.
 */
export function effectiveRequestTimeoutMs(configuredMs: number, remainingRunMs: number): number {
  if (configuredMs <= 0) return 0;
  if (!Number.isFinite(remainingRunMs)) return configuredMs;
  return Math.max(MIN_EFFECTIVE_REQUEST_TIMEOUT_MS, Math.min(configuredMs, remainingRunMs));
}

type LlmStallKind = "request" | "idle";

export class LlmTurnStallError extends Error {
  readonly code = "llm_turn_stalled";

  constructor(
    readonly kind: LlmStallKind,
    readonly waitedMs: number,
  ) {
    super(
      kind === "idle"
        ? `LLM stream produced no event for ${Math.round(waitedMs / 1000)}s.`
        : `LLM request exceeded its ${Math.round(waitedMs / 1000)}s ceiling.`,
    );
    this.name = "LlmTurnStallError";
  }
}

export function isLlmTurnStallError(error: unknown): error is LlmTurnStallError {
  return error instanceof LlmTurnStallError;
}

interface StallDecision {
  action: "retry" | "stop";
  message: string;
}

/**
 * Nothing was streamed, so replaying the request cannot duplicate output — but a
 * provider that stalled twice in a row is not going to answer this run either.
 */
export function decideAfterStall(
  consecutiveStalls: number,
  limits: Pick<ResolvedLlmTurnStallOptions, "maxConsecutiveStalls">,
): StallDecision {
  if (consecutiveStalls >= limits.maxConsecutiveStalls) {
    return {
      action: "stop",
      message: `Stopped after ${consecutiveStalls} consecutive stalled LLM turns — the provider is not responding.`,
    };
  }
  return {
    action: "retry",
    message: `LLM turn stalled — retrying (${consecutiveStalls}/${limits.maxConsecutiveStalls})…`,
  };
}

interface LlmTurnStallGuard {
  /** Pass this to the provider instead of the run signal. */
  signal: AbortSignal;
  /** Call on every stream event to disarm the idle watchdog. */
  noteActivity: () => void;
  /** Turns an abort this guard caused into an `LlmTurnStallError`. */
  translate: (error: unknown) => unknown;
  dispose: () => void;
}

/**
 * The provider only ever sees an abort, so the guard remembers whether it fired
 * and rewrites the error afterwards — otherwise a stall is indistinguishable
 * from the user pressing stop.
 */
export function createLlmTurnStallGuard(opts: {
  outerSignal: AbortSignal;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
}): LlmTurnStallGuard {
  const controller = new AbortController();
  const startedAt = Date.now();
  let stall: LlmStallKind | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const trip = (kind: LlmStallKind): void => {
    if (stall !== undefined || opts.outerSignal.aborted) return;
    stall = kind;
    controller.abort(new DOMException(`LLM turn ${kind} timeout`, "TimeoutError"));
  };

  const requestTimer =
    opts.requestTimeoutMs > 0
      ? setTimeout(() => trip("request"), opts.requestTimeoutMs)
      : undefined;

  const armIdle = (): void => {
    if (opts.streamIdleTimeoutMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => trip("idle"), opts.streamIdleTimeoutMs);
  };
  armIdle();

  return {
    signal: AbortSignal.any([opts.outerSignal, controller.signal]),
    noteActivity: armIdle,
    translate: (error) =>
      stall === undefined || opts.outerSignal.aborted
        ? error
        : new LlmTurnStallError(stall, Date.now() - startedAt),
    dispose: () => {
      if (requestTimer) clearTimeout(requestTimer);
      if (idleTimer) clearTimeout(idleTimer);
    },
  };
}
