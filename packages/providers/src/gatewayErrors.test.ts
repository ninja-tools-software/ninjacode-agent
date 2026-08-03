import { describe, expect, it } from "vitest";
import {
  GatewayError,
  gatewayErrorInfo,
  isTerminalGatewayCode,
  parseGatewayError,
} from "./gatewayErrors.js";

describe("parseGatewayError", () => {
  it("parses unauthorized 401", () => {
    const err = parseGatewayError('{"error":"unauthorized"}', { status: 401 });
    expect(err).toBeInstanceOf(GatewayError);
    expect(err?.code).toBe("unauthorized");
    expect(err?.status).toBe(401);
  });

  it("parses account_suspended 403", () => {
    const err = parseGatewayError('{"error":"account_suspended"}', { status: 403 });
    expect(err?.code).toBe("account_suspended");
  });

  it("parses model_not_in_catalog with model and catalog", () => {
    const err = parseGatewayError(
      JSON.stringify({ error: "model_not_in_catalog", model: "gpt-5", catalog: "starter" }),
      { status: 403 },
    );
    expect(err?.code).toBe("model_not_in_catalog");
    expect(err?.model).toBe("gpt-5");
    expect(err?.catalog).toBe("starter");
  });

  it("parses rate_limited 429", () => {
    const err = parseGatewayError('{"error":"rate_limited"}', { status: 429 });
    expect(err?.code).toBe("rate_limited");
    expect(isTerminalGatewayCode(err!.code)).toBe(false);
  });

  it("parses model_not_priced 503", () => {
    const err = parseGatewayError(
      JSON.stringify({ error: "model_not_priced", model: "claude-opus-4" }),
      { status: 503 },
    );
    expect(err?.code).toBe("model_not_priced");
    expect(err?.model).toBe("claude-opus-4");
    expect(isTerminalGatewayCode(err!.code)).toBe(true);
  });

  it("parses insufficient_credits with renewsAt and planTier", () => {
    const err = parseGatewayError(
      JSON.stringify({
        error: "insufficient_credits",
        message: "You've used all your credits for this cycle.",
        renewsAt: "2026-09-01T00:00:00.000Z",
        planTier: "pro",
      }),
      { status: 402 },
    );
    expect(err?.code).toBe("insufficient_credits");
    expect(err?.message).toContain("You've used all your credits");
    expect(err?.renewsAt).toBe("2026-09-01T00:00:00.000Z");
    expect(err?.planTier).toBe("pro");
  });

  it("parses SSE insufficient_credits string with partial flag", () => {
    const err = parseGatewayError('{"error":"insufficient_credits"}', { partial: true });
    expect(err?.code).toBe("insufficient_credits");
    expect(err?.partial).toBe(true);
  });

  it("parses a bare known code (sseErrorMessage unwrap)", () => {
    const err = parseGatewayError("insufficient_credits", { partial: true });
    expect(err?.code).toBe("insufficient_credits");
    expect(err?.partial).toBe(true);
  });

  it("maps idle timeout messages to upstream_timeout", () => {
    const err = parseGatewayError(
      JSON.stringify({ error: "Upstream idle timeout after 60000ms" }),
    );
    expect(err?.code).toBe("upstream_timeout");
    expect(isTerminalGatewayCode(err!.code)).toBe(false);
  });

  it("returns null for 502 passthrough messages", () => {
    const err = parseGatewayError(
      JSON.stringify({ error: "connect ECONNREFUSED 10.0.0.1:443" }),
      { status: 502 },
    );
    expect(err).toBeNull();
  });

  it("extracts JSON embedded in an OpenAICompatibleProvider message", () => {
    const raw = `ninjacode-gateway error 402: ${JSON.stringify({
      error: "insufficient_credits",
      renewsAt: null,
      planTier: null,
    })}`;
    const err = parseGatewayError(raw, { status: 402, provider: "ninjacode-gateway" });
    expect(err?.code).toBe("insufficient_credits");
    expect(err?.provider).toBe("ninjacode-gateway");
  });
});

describe("gatewayErrorInfo", () => {
  it("serializes a GatewayError and ignores other errors", () => {
    const err = new GatewayError("rate_limited", "rate_limited", { status: 429 });
    expect(gatewayErrorInfo(err)).toEqual({
      code: "rate_limited",
      renewsAt: undefined,
      planTier: undefined,
      model: undefined,
      catalog: undefined,
      partial: undefined,
    });
    expect(gatewayErrorInfo(new Error("nope"))).toBeUndefined();
  });
});
