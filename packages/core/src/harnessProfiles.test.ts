import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import {
  filterToolsForHarnessProfile,
  resolveHarnessProfile,
  type HarnessProfile,
} from "./harnessProfiles.js";

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
    expect(first.editFormat).toBe("patch");
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
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.optionalTools)).toBe(true);
  });

  it("exposes reasoning only for profiles backed by the existing effort type", () => {
    expect(resolveHarnessProfile({ modelId: "o3" }).reasoningEffort).toBe("high");
    expect(resolveHarnessProfile({ modelId: "claude-opus-4-20250514" }).reasoningEffort)
      .toBeUndefined();
  });

  it("filters only the optional tool namespace", () => {
    const base = resolveHarnessProfile({ modelId: "gpt-4.1" });
    const profile: HarnessProfile = {
      ...base,
      optionalTools: ["git_status"],
    };
    const tools = filterToolsForHarnessProfile(createDefaultToolRegistry(), profile);

    expect(tools.get("git_status")).toBeDefined();
    expect(tools.get("git_diff")).toBeUndefined();
    expect(tools.get("read_file")).toBeDefined();
  });
});
