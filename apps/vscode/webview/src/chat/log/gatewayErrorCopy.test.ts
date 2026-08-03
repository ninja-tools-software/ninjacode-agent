import { describe, expect, it } from "vitest";
import { gatewayErrorCardSpec } from "./gatewayErrorCopy.js";

describe("gatewayErrorCardSpec", () => {
  it("uses the partial copy for mid-stream credit exhaustion", () => {
    const spec = gatewayErrorCardSpec({ code: "insufficient_credits", partial: true });
    expect(spec.severity).toBe("block");
    expect(spec.title).toBe("Answer stopped — out of credits");
    expect(spec.actions.map((a) => a.id)).toEqual(["upgrade", "account"]);
  });

  it("passes renewsAt through for the UI to format", () => {
    const spec = gatewayErrorCardSpec({
      code: "insufficient_credits",
      renewsAt: "2026-09-01T00:00:00.000Z",
    });
    expect(spec.renewsAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("offers change_model for model_not_priced", () => {
    const spec = gatewayErrorCardSpec({ code: "model_not_priced", model: "claude-opus-4" });
    expect(spec.titleArgs).toEqual(["claude-opus-4"]);
    expect(spec.actions[0]).toMatchObject({ id: "change_model", primary: true });
  });

  it("offers upgrade + change_model for model_not_in_catalog", () => {
    const spec = gatewayErrorCardSpec({
      code: "model_not_in_catalog",
      model: "gpt-5",
      catalog: "starter",
    });
    expect(spec.bodyArgs).toEqual(["starter"]);
    expect(spec.actions.map((a) => a.id)).toEqual(["upgrade", "change_model"]);
  });

  it("has no CTAs for rate_limited and upstream_timeout", () => {
    expect(gatewayErrorCardSpec({ code: "rate_limited" }).actions).toEqual([]);
    expect(gatewayErrorCardSpec({ code: "upstream_timeout" }).actions).toEqual([]);
  });

  it("offers sign_in for unauthorized", () => {
    expect(gatewayErrorCardSpec({ code: "unauthorized" }).actions[0]?.id).toBe("sign_in");
  });
});
