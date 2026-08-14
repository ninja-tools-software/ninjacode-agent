import { describe, expect, it } from "vitest";
import {
  enrichRunConfigFromLiveModels,
  resolveContextWindow,
  type ContextWindowConfig,
} from "./runConfigContext.js";

describe("resolveContextWindow", () => {
  it("caps a configured window to the model maximum", () => {
    expect(resolveContextWindow(1_000_000, { contextWindow: 500_000 })).toBe(500_000);
  });

  it("uses the model default when the setting is 0", () => {
    expect(
      resolveContextWindow(0, { contextWindow: 1_000_000, defaultContextWindow: 200_000 }),
    ).toBe(200_000);
    expect(resolveContextWindow(0, { contextWindow: 500_000 })).toBe(500_000);
  });

  it("returns undefined when nothing is configured and the model is unknown", () => {
    expect(resolveContextWindow(0, undefined)).toBeUndefined();
  });
});

describe("enrichRunConfigFromLiveModels", () => {
  const grok = { id: "grok-4.5", contextWindow: 500_000, defaultContextWindow: 200_000 };

  it("fills contextWindow for a gateway model missing from the static catalog", () => {
    const input: ContextWindowConfig = { kind: "gateway", model: "grok-4.5" };
    const next = enrichRunConfigFromLiveModels(input, [{ id: "grok-4.5", contextWindow: 500_000 }]);
    expect(next.contextWindow).toBe(500_000);
  });

  it("prefers the model's recommended default over the raw maximum", () => {
    const input: ContextWindowConfig = { kind: "gateway", model: "grok-4.5" };
    const next = enrichRunConfigFromLiveModels(input, [
      { id: "grok-4.5", contextWindow: 500_000, defaultContextWindow: 200_000 },
    ]);
    expect(next.contextWindow).toBe(200_000);
  });

  it("leaves an already resolved window alone", () => {
    const next = enrichRunConfigFromLiveModels(
      { kind: "gateway" as const, model: "grok-4.5", contextWindow: 128_000 },
      [grok],
    );
    expect(next.contextWindow).toBe(128_000);
  });

  it("ignores non-gateway providers", () => {
    const input: ContextWindowConfig = { kind: "anthropic", model: "grok-4.5" };
    const next = enrichRunConfigFromLiveModels(input, [grok]);
    expect(next.contextWindow).toBeUndefined();
  });
});
