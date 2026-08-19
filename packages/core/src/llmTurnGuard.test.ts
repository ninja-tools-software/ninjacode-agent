import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLlmTurnStallGuard,
  decideAfterStall,
  DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS,
  effectiveRequestTimeoutMs,
  isLlmTurnStallError,
  LlmTurnStallError,
  resolveLlmTurnStallOptions,
} from "./llmTurnGuard.js";

describe("resolveLlmTurnStallOptions", () => {
  it("defaults to ceilings that tolerate extended thinking", () => {
    expect(resolveLlmTurnStallOptions()).toEqual({
      requestTimeoutMs: DEFAULT_LLM_REQUEST_TIMEOUT_MS,
      streamIdleTimeoutMs: DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS,
      maxConsecutiveStalls: 2,
    });
  });

  it("treats zero as an explicit opt-out and floors positive values", () => {
    const resolved = resolveLlmTurnStallOptions({
      requestTimeoutMs: 0,
      streamIdleTimeoutMs: 5,
      maxConsecutiveStalls: 0,
    });
    expect(resolved.requestTimeoutMs).toBe(0);
    expect(resolved.streamIdleTimeoutMs).toBe(1_000);
    expect(resolved.maxConsecutiveStalls).toBe(1);
  });

  it("ignores non-finite input", () => {
    const resolved = resolveLlmTurnStallOptions({
      requestTimeoutMs: Number.NaN,
      maxConsecutiveStalls: Number.POSITIVE_INFINITY,
    });
    expect(resolved.requestTimeoutMs).toBe(DEFAULT_LLM_REQUEST_TIMEOUT_MS);
    expect(resolved.maxConsecutiveStalls).toBe(2);
  });
});

describe("effectiveRequestTimeoutMs", () => {
  it("keeps the configured ceiling on an untimed run", () => {
    expect(effectiveRequestTimeoutMs(300_000, Number.POSITIVE_INFINITY)).toBe(300_000);
  });

  it("never waits longer than the run has left", () => {
    expect(effectiveRequestTimeoutMs(300_000, 90_000)).toBe(90_000);
  });

  it("still grants a floor when the run is nearly over", () => {
    expect(effectiveRequestTimeoutMs(300_000, 500)).toBe(10_000);
  });

  it("stays disabled when the ceiling is opted out", () => {
    expect(effectiveRequestTimeoutMs(0, 90_000)).toBe(0);
  });
});

describe("decideAfterStall", () => {
  it("retries below the budget", () => {
    expect(decideAfterStall(1, { maxConsecutiveStalls: 2 })).toMatchObject({ action: "retry" });
  });

  it("stops once the consecutive budget is spent", () => {
    const decision = decideAfterStall(2, { maxConsecutiveStalls: 2 });
    expect(decision.action).toBe("stop");
    expect(decision.message).toMatch(/not responding/);
  });
});

describe("LlmTurnStallError", () => {
  it("distinguishes an idle stream from an overall ceiling", () => {
    expect(new LlmTurnStallError("idle", 120_000).message).toMatch(/no event for 120s/);
    expect(new LlmTurnStallError("request", 300_000).message).toMatch(/300s ceiling/);
    expect(isLlmTurnStallError(new Error("other"))).toBe(false);
  });
});

describe("createLlmTurnStallGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts and reports a stall when the request ceiling passes", () => {
    const outer = new AbortController();
    const guard = createLlmTurnStallGuard({
      outerSignal: outer.signal,
      requestTimeoutMs: 1_000,
      streamIdleTimeoutMs: 0,
    });

    vi.advanceTimersByTime(1_001);

    expect(guard.signal.aborted).toBe(true);
    const translated = guard.translate(new DOMException("Aborted", "AbortError"));
    expect(isLlmTurnStallError(translated)).toBe(true);
    expect((translated as LlmTurnStallError).kind).toBe("request");
    guard.dispose();
  });

  it("aborts on stream silence and rearms on every event", () => {
    const outer = new AbortController();
    const guard = createLlmTurnStallGuard({
      outerSignal: outer.signal,
      requestTimeoutMs: 0,
      streamIdleTimeoutMs: 1_000,
    });

    vi.advanceTimersByTime(900);
    guard.noteActivity();
    vi.advanceTimersByTime(900);
    expect(guard.signal.aborted).toBe(false);

    vi.advanceTimersByTime(200);
    expect(guard.signal.aborted).toBe(true);
    expect((guard.translate(new Error("aborted")) as LlmTurnStallError).kind).toBe("idle");
    guard.dispose();
  });

  it("leaves a user abort alone so stop is never reported as a stall", () => {
    const outer = new AbortController();
    const guard = createLlmTurnStallGuard({
      outerSignal: outer.signal,
      requestTimeoutMs: 1_000,
      streamIdleTimeoutMs: 1_000,
    });

    outer.abort(new DOMException("User stopped", "AbortError"));
    vi.advanceTimersByTime(5_000);

    const original = new DOMException("User stopped", "AbortError");
    expect(guard.translate(original)).toBe(original);
    guard.dispose();
  });

  it("passes provider errors through untouched when it never fired", () => {
    const outer = new AbortController();
    const guard = createLlmTurnStallGuard({
      outerSignal: outer.signal,
      requestTimeoutMs: 10_000,
      streamIdleTimeoutMs: 10_000,
    });

    const failure = new Error("HTTP 500");
    expect(guard.translate(failure)).toBe(failure);
    guard.dispose();
  });
});
