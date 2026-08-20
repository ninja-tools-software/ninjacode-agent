import { describe, expect, it } from "vitest";
import { resolveHarnessProfile } from "./harnessProfiles.js";

describe("versioned harness profiles", () => {
  it("resolves exact model overrides before a conflicting provider family", () => {
    const profile = resolveHarnessProfile({
      providerKind: "gateway",
      modelId: "claude-opus-4-20250514",
    });

    expect(profile).toMatchObject({
      version: "v1",
      source: "model",
      key: "claude-opus-4-20250514",
      editFormat: "string_replace",
      verification: "strict",
    });
  });

  it("infers a model family before falling back to the provider family", () => {
    const profile = resolveHarnessProfile({
      providerKind: "gateway",
      modelId: "claude-future-5",
    });

    expect(profile).toMatchObject({
      source: "family",
      key: "anthropic",
      editFormat: "string_replace",
    });
  });

  it("normalizes retry wrappers and model casing deterministically", () => {
    const first = resolveHarnessProfile({
      providerKind: "OPENAI+retry",
      modelId: " GPT-4.1 ",
    });
    const second = resolveHarnessProfile({
      providerKind: "openai",
      modelId: "gpt-4.1",
      version: "v1",
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ source: "family", key: "openai", editFormat: "patch" });
  });

  it("uses an immutable default for unknown families and models", () => {
    const profile = resolveHarnessProfile({
      providerKind: "future-provider",
      modelId: "future-model",
    });

    expect(profile).toMatchObject({
      source: "default",
      key: "default",
      editFormat: "string_replace",
      verification: "standard",
      verificationMode: "current",
      orchestration: "standard",
    });
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("raises Grok 4.6 reasoning while inheriting its family's edits", () => {
    const profile = resolveHarnessProfile({
      providerKind: "xai",
      modelId: "grok-4.6",
    });
    expect(profile).toMatchObject({
      source: "model",
      key: "grok-4.6",
      editFormat: "string_replace",
      orchestration: "adaptive",
      reasoningEffort: "high",
    });
  });

  /** A restated family value would hide which field is really the exception. */
  it("keeps model entries down to what differs from their family", () => {
    const grok = resolveHarnessProfile({ modelId: "grok-4.6" });
    const family = resolveHarnessProfile({ modelId: "grok-4.5" });
    expect(grok.editFormat).toBe(family.editFormat);
    expect(grok.orchestration).toBe(family.orchestration);
    expect(grok.reasoningEffort).not.toBe(family.reasoningEffort);
  });

  it("keeps Grok 4.5 on string_replace with no reasoning override", () => {
    expect(resolveHarnessProfile({ modelId: "grok-4.5" })).toMatchObject({
      source: "family",
      key: "xai",
      editFormat: "string_replace",
      orchestration: "adaptive",
      reasoningEffort: undefined,
    });
  });

  it("exposes reasoning only for profiles backed by the existing effort type", () => {
    expect(resolveHarnessProfile({ modelId: "o3" }).reasoningEffort).toBe("high");
    expect(resolveHarnessProfile({ modelId: "claude-opus-4-20250514" }).reasoningEffort)
      .toBeUndefined();
  });

});
