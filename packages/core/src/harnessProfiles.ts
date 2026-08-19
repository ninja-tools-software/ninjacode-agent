import type { ProviderKind, ReasoningEffort } from "@ninjacode/providers";
import type { OrchestrationProfile } from "./phasePolicy.js";
import type { VerificationMode } from "./verificationTypes.js";

export type HarnessProfileVersion = "v1";
export type VerificationPolicy = "standard" | "strict";
/**
 * How the harness lets a model edit files. This is a harness decision, not a
 * model fact, so it lives here and nowhere else — the model catalog in
 * `@ninjacode/providers` describes models, it does not configure the loop.
 */
export type EditFormat = "string_replace" | "patch";

export interface HarnessProfile {
  readonly version: HarnessProfileVersion;
  readonly source: "default" | "family" | "model";
  readonly key: string;
  readonly editFormat: EditFormat;
  readonly verification: VerificationPolicy;
  readonly verificationMode: VerificationMode;
  readonly orchestration: OrchestrationProfile;
  readonly reasoningEffort?: ReasoningEffort;
}

export interface ResolveHarnessProfileInput {
  providerKind?: string;
  modelId?: string;
  version?: HarnessProfileVersion;
}

type ProfileOverrides = Partial<
  Pick<
    HarnessProfile,
    "editFormat" | "verification" | "verificationMode" | "orchestration" | "reasoningEffort"
  >
>;

const DEFAULT_PROFILE: ProfileOverrides = Object.freeze({
  editFormat: "string_replace",
  verification: "standard",
  verificationMode: "current",
  orchestration: "legacy",
});

const FAMILY_PROFILES: Readonly<Partial<Record<ProviderKind, ProfileOverrides>>> = Object.freeze({
  anthropic: Object.freeze({ editFormat: "string_replace" }),
  openai: Object.freeze({ editFormat: "patch" }),
  deepseek: Object.freeze({ editFormat: "patch" }),
  openrouter: Object.freeze({ editFormat: "patch" }),
  moonshot: Object.freeze({ editFormat: "patch" }),
  glm: Object.freeze({ editFormat: "patch" }),
  mistral: Object.freeze({ editFormat: "patch" }),
  xai: Object.freeze({ editFormat: "string_replace", orchestration: "adaptive" }),
  mammouth: Object.freeze({ editFormat: "patch" }),
  "openai-compatible": Object.freeze({ editFormat: "patch" }),
  gateway: Object.freeze({ editFormat: "patch" }),
});

/**
 * Only what differs from the model's family. Restating a family value here would
 * read as a deliberate per-model choice and hide the one field that is really an
 * exception.
 */
const MODEL_PROFILES: Readonly<Record<string, ProfileOverrides>> = Object.freeze({
  "claude-opus-4-20250514": Object.freeze({ verification: "strict" }),
  o3: Object.freeze({ verification: "strict", reasoningEffort: "high" }),
  "o4-mini": Object.freeze({ reasoningEffort: "medium" }),
  "deepseek-v4-flash": Object.freeze({ reasoningEffort: "medium" }),
  "deepseek-v4-pro": Object.freeze({ verification: "strict", reasoningEffort: "high" }),
  "grok-4.6": Object.freeze({ reasoningEffort: "xhigh" }),
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

/** Resolve v1 profiles deterministically: exact model, then family, then default. */
export function resolveHarnessProfile(input: ResolveHarnessProfileInput = {}): HarnessProfile {
  const version = input.version ?? "v1";
  const modelKey = input.modelId?.trim().toLowerCase();
  const familyKey = familyForModel(modelKey) ?? normalizedProvider(input.providerKind);
  const family = familyKey ? FAMILY_PROFILES[familyKey] : undefined;
  const model = modelKey ? MODEL_PROFILES[modelKey] : undefined;
  const source = model ? "model" : family ? "family" : "default";
  const key = model ? modelKey! : family ? familyKey! : "default";

  return Object.freeze({
    version,
    source,
    key,
    editFormat: model?.editFormat ?? family?.editFormat ?? DEFAULT_PROFILE.editFormat!,
    verification: model?.verification ?? family?.verification ?? DEFAULT_PROFILE.verification!,
    verificationMode:
      model?.verificationMode ?? family?.verificationMode ?? DEFAULT_PROFILE.verificationMode!,
    orchestration: model?.orchestration ?? family?.orchestration ?? DEFAULT_PROFILE.orchestration!,
    reasoningEffort: model?.reasoningEffort ?? family?.reasoningEffort,
  });
}
