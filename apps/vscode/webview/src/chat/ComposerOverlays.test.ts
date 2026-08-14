import { describe, expect, it } from "vitest";
import { resolveMeterUsage } from "./ComposerOverlays.js";
import type { ContextUsage, ModelInfo, SettingsState } from "./types.js";

const model: ModelInfo = {
  id: "grok-4.5",
  label: "Grok 4.5",
  contextWindow: 500_000,
  maxOutput: 16_000,
  defaultContextWindow: 200_000,
};

function settings(partial: Partial<SettingsState> = {}): SettingsState {
  return {
    contextWindow: 0,
    modelInfo: model,
    ...partial,
  } as SettingsState;
}

const live: ContextUsage = {
  system: 1_200,
  history: 800,
  tools: 400,
  files: 100,
  output: 8_000,
  total: 2_500,
  window: 200_000,
};

describe("resolveMeterUsage", () => {
  it("keeps a live usage snapshot with a known window", () => {
    expect(resolveMeterUsage(live, settings(), model)).toEqual(live);
  });

  it("falls back to the model default window when usage is missing", () => {
    expect(resolveMeterUsage(null, settings(), model)).toEqual({
      total: 0,
      window: 200_000,
      system: 0,
      history: 0,
      tools: 0,
      files: 0,
      output: 0,
    });
  });

  it("uses a configured window capped by the model max", () => {
    expect(resolveMeterUsage(null, settings({ contextWindow: 300_000 }), model)?.window).toBe(
      300_000,
    );
    expect(resolveMeterUsage(null, settings({ contextWindow: 900_000 }), model)?.window).toBe(
      500_000,
    );
  });

  it("repairs a zero-window usage payload from model info", () => {
    expect(
      resolveMeterUsage({ ...live, window: 0 }, settings({ contextWindow: 0 }), model),
    ).toMatchObject({ total: live.total, window: 200_000, system: live.system });
  });

  it("hides the meter when no window can be resolved", () => {
    expect(resolveMeterUsage(null, settings({ contextWindow: 0 }), undefined)).toBeNull();
  });
});
