import { describe, expect, it } from "vitest";
import {
  anthropicErrorStatus,
  anthropicHttpError,
  isAnthropicContextOverflow,
  parseAnthropicErrorDetail,
} from "./anthropicErrors.js";
import { parseRetryAfterMs } from "./retryAfter.js";

describe("parseAnthropicErrorDetail", () => {
  it("reads the typed error envelope", () => {
    expect(
      parseAnthropicErrorDetail('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'),
    ).toEqual({ type: "overloaded_error", message: "Overloaded" });
  });

  it("returns nothing for non-JSON or unexpected shapes", () => {
    expect(parseAnthropicErrorDetail("<html>502</html>")).toEqual({});
    expect(parseAnthropicErrorDetail('{"error":"boom"}')).toEqual({});
    expect(parseAnthropicErrorDetail("null")).toEqual({});
  });
});

describe("anthropicErrorStatus", () => {
  it("maps an overload to a retryable status even off a 200 stream", () => {
    expect(anthropicErrorStatus("overloaded_error")).toBe(529);
    expect(anthropicErrorStatus("rate_limit_error")).toBe(429);
  });

  it("keeps invalid requests final", () => {
    expect(anthropicErrorStatus("invalid_request_error", 500)).toBe(400);
  });

  it("falls back to the transport status for unknown types", () => {
    expect(anthropicErrorStatus("brand_new_error", 503)).toBe(503);
    expect(anthropicErrorStatus(undefined, 503)).toBe(503);
    expect(anthropicErrorStatus(undefined)).toBeUndefined();
  });
});

describe("isAnthropicContextOverflow", () => {
  it("recognizes a prompt that no retry can fix", () => {
    expect(
      isAnthropicContextOverflow({
        type: "invalid_request_error",
        message: "prompt is too long: 250000 tokens > 200000 maximum",
      }),
    ).toBe(true);
  });

  it("does not claim every invalid request is an overflow", () => {
    expect(
      isAnthropicContextOverflow({ type: "invalid_request_error", message: "unknown field 'foo'" }),
    ).toBe(false);
    expect(isAnthropicContextOverflow({ type: "overloaded_error", message: "too long" })).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  it("reads delay-seconds", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
    expect(parseRetryAfterMs(" 1.5 ")).toBe(1_500);
  });

  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-08-19T10:00:00Z");
    expect(parseRetryAfterMs("Wed, 19 Aug 2026 10:00:45 GMT", now)).toBe(45_000);
  });

  it("ignores a past date, garbage, or a missing header", () => {
    const now = Date.parse("2026-08-19T10:00:00Z");
    expect(parseRetryAfterMs("Wed, 19 Aug 2026 09:59:00 GMT", now)).toBeUndefined();
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});

describe("anthropicHttpError", () => {
  it("upgrades the status from the typed body and carries Retry-After", () => {
    const error = anthropicHttpError({
      status: 500,
      body: '{"error":{"type":"rate_limit_error","message":"Too many requests"}}',
      retryAfter: "12",
    });
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(12_000);
    expect(error.provider).toBe("anthropic");
    expect(error.message).toContain("rate_limit_error");
    expect(error.message).toContain("Too many requests");
  });

  it("tells the model what to do about an overflowing prompt", () => {
    const error = anthropicHttpError({
      status: 400,
      body: '{"error":{"type":"invalid_request_error","message":"prompt is too long"}}',
    });
    expect(error.status).toBe(400);
    expect(error.message).toContain("compact the conversation");
  });

  it("keeps an unparsable body as the message", () => {
    const error = anthropicHttpError({ status: 502, body: "Bad Gateway" });
    expect(error.status).toBe(502);
    expect(error.message).toContain("Bad Gateway");
    expect(error.retryAfterMs).toBeUndefined();
  });
});
