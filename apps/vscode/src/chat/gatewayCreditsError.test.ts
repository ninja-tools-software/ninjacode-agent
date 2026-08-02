import { describe, expect, it } from "vitest";
import { isGatewayCreditsError } from "./gatewayCreditsError.js";

describe("isGatewayCreditsError", () => {
  it("matches the gateway insufficient_credits payload", () => {
    expect(
      isGatewayCreditsError(
        'ninjacode error 402: {"error":"insufficient_credits","message":"You\'ve used all your credits"}',
      ),
    ).toBe(true);
  });

  it("ignores upstream 402s that are not NinjaCode credit exhaustion", () => {
    expect(isGatewayCreditsError("Upstream error: 402 {\"error\":\"Insufficient credits\"}")).toBe(
      false,
    );
    expect(isGatewayCreditsError("openrouter error 402: Payment Required")).toBe(false);
  });

  it("ignores unrelated failures", () => {
    expect(isGatewayCreditsError("HTTP 500: internal error")).toBe(false);
  });
});
