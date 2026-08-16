import type { ProviderKind, ReasoningEffort } from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";

export type HarnessProfileVersion = "v1";
export type VerificationPolicy = "standard" | "strict";
export type EditFormat = "string_replace" | "patch";

export interface HarnessProfile {
  readonly version: HarnessProfileVersion;
  readonly source: "default" | "family" | "model";
  readonly key: string;
  readonly editFormat: EditFormat;
  readonly optionalTools: readonly string[];
  readonly verification: VerificationPolicy;
  readonly reasoningEffort?: ReasoningEffort;
}

export interface ResolveHarnessProfileInput {
  providerKind?: string;
  modelId?: string;
  version?: HarnessProfileVersion;
}

type ProfileOverrides = Partial<
  Pick<HarnessProfile, "editFormat" | "optionalTools" | "verification" | "reasoningEffort">
>;

const GIT_TOOLS = Object.freeze(["git_status", "git_diff", "git_log", "git_show"]);
const OPTIONAL_TOOL_NAMES = new Set(GIT_TOOLS);

const DEFAULT_PROFILE: ProfileOverrides = Object.freeze({
  editFormat: "string_replace",
  optionalTools: GIT_TOOLS,
  verification: "standard",
});

const FAMILY_PROFILES: Readonly<Partial<Record<ProviderKind, ProfileOverrides>>> = Object.freeze({
  anthropic: Object.freeze({ editFormat: "string_replace" }),
  openai: Object.freeze({ editFormat: "patch" }),
  deepseek: Object.freeze({ editFormat: "patch" }),
  openrouter: Object.freeze({ editFormat: "patch" }),
  moonshot: Object.freeze({ editFormat: "patch" }),
  glm: Object.freeze({ editFormat: "patch" }),
  mistral: Object.freeze({ editFormat: "patch" }),
  xai: Object.freeze({ editFormat: "patch" }),
  mammouth: Object.freeze({ editFormat: "patch" }),
  "openai-compatible": Object.freeze({ editFormat: "patch" }),
  gateway: Object.freeze({ editFormat: "patch" }),
});

const MODEL_PROFILES: Readonly<Record<string, ProfileOverrides>> = Object.freeze({
  "claude-opus-4-20250514": Object.freeze({
    editFormat: "string_replace",
    verification: "strict",
  }),
  "gpt-4o": Object.freeze({ editFormat: "patch" }),
  "gpt-4.1": Object.freeze({ editFormat: "patch" }),
  o3: Object.freeze({
    editFormat: "patch",
    verification: "strict",
    reasoningEffort: "high",
  }),
  "o4-mini": Object.freeze({
    editFormat: "patch",
    reasoningEffort: "medium",
  }),
  "deepseek-v4-flash": Object.freeze({
    editFormat: "patch",
    reasoningEffort: "medium",
  }),
  "deepseek-v4-pro": Object.freeze({
    editFormat: "patch",
    verification: "strict",
    reasoningEffort: "high",
  }),
});

function normalizedProvider(value: string | undefined): ProviderKind | undefined {
  const normalized = value?.trim().toLowerCase().replace(/\+retry$/u, "");
  if (!normalized) return undefined;
  return normalized in FAMILY_PROFILES ? normalized as ProviderKind : undefined;
}

function familyForModel(modelId: string | undefined): ProviderKind | undefined {
  if (!modelId) return undefined;
  if (modelId.startsWith("claude-")) return "anthropic";
  if (/^(gpt-|o3(?:-|$)|o4-)/u.test(modelId)) return "openai";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (/^(kimi-|moonshot-)/u.test(modelId)) return "moonshot";
  if (modelId.startsWith("glm-")) return "glm";
  if (/^(mistral-|codestral-)/u.test(modelId)) return "mistral";
  if (modelId.startsWith("grok-")) return "xai";
  return undefined;
}

function freezeProfile(profile: HarnessProfile): HarnessProfile {
  return Object.freeze({
    ...profile,
    optionalTools: Object.freeze([...profile.optionalTools]),
  });
}

/** Resolve v1 profiles deterministically: exact model, then family, then default. */
export function resolveHarnessProfile(input: ResolveHarnessProfileInput = {}): HarnessProfile {
  const version = input.version ?? "v1";
  const modelKey = input.modelId?.trim().toLowerCase();
  const familyKey = familyForModel(modelKey) ?? normalizedProvider(input.providerKind);
  const family = familyKey ? FAMILY_PROFILES[familyKey] : undefined;
  const model = modelKey ? MODEL_PROFILES[modelKey] : undefined;
  const source = model ? "model" : family ? "family" : "default";
  const key = model ? modelKey! : family ? familyKey! : "default";

  return freezeProfile({
    version,
    source,
    key,
    editFormat: model?.editFormat ?? family?.editFormat ?? DEFAULT_PROFILE.editFormat!,
    optionalTools: model?.optionalTools ?? family?.optionalTools ?? DEFAULT_PROFILE.optionalTools!,
    verification: model?.verification ?? family?.verification ?? DEFAULT_PROFILE.verification!,
    reasoningEffort: model?.reasoningEffort ?? family?.reasoningEffort,
  });
}

/**
 * Keep ordinary tools and expose only profile-enabled optional tools.
 * Integration is host-safe because absent optional tools are simply ignored.
 */
export function filterToolsForHarnessProfile(
  registry: ToolRegistry,
  profile: HarnessProfile,
): ToolRegistry {
  const enabled = new Set(profile.optionalTools);
  return registry.filter((tool) => !OPTIONAL_TOOL_NAMES.has(tool.name) || enabled.has(tool.name));
}
