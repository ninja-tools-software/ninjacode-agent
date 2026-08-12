import { describe, expect, it } from "vitest";
import type { SettingsState } from "../types.js";
import { needsGatewayOnboarding } from "./onboardingVisibility.js";

function settings(over: Partial<SettingsState> = {}): SettingsState {
  return {
    provider: "anthropic",
    gatewayConfigured: false,
    hasApiKey: {},
    ...over,
  } as SettingsState;
}

describe("needsGatewayOnboarding", () => {
  it("stays hidden until settings arrive, to avoid a flash on reload", () => {
    expect(needsGatewayOnboarding(null)).toBe(false);
  });

  it("shows when nothing at all is configured", () => {
    expect(needsGatewayOnboarding(settings())).toBe(true);
  });

  it("hides once the gateway is signed in", () => {
    expect(needsGatewayOnboarding(settings({ gatewayConfigured: true }))).toBe(false);
  });

  it("hides once any real provider has a key", () => {
    expect(
      needsGatewayOnboarding(settings({ hasApiKey: { anthropic: true } as never })),
    ).toBe(false);
  });

  it("ignores keyless providers when looking for a configured key", () => {
    expect(needsGatewayOnboarding(settings({ hasApiKey: { local: true } as never }))).toBe(true);
  });

  it("hides for a local model runner, which needs no key", () => {
    expect(needsGatewayOnboarding(settings({ provider: "local" }))).toBe(false);
  });

  it("hides for the mock provider used in tests and demos", () => {
    expect(needsGatewayOnboarding(settings({ provider: "mock" }))).toBe(false);
  });

  it("ignores a leftover gateway key in hasApiKey — Pass state is gatewayConfigured", () => {
    expect(
      needsGatewayOnboarding(settings({ hasApiKey: { gateway: true } as never })),
    ).toBe(true);
  });
});
