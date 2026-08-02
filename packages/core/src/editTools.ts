import type { ProviderKind } from "@ninjacode/providers";
import { findModelAnywhere } from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";

export type EditFormat = "string_replace" | "patch";

/** Infer preferred edit format from provider/model training (Cursor pattern). */
export function preferredEditFormat(providerKind?: string, modelId?: string): EditFormat {
  const model = modelId ? findModelAnywhere(modelId) : undefined;
  if (model?.editFormat) return model.editFormat;

  const kind = providerKind?.replace(/\+retry$/, "") as ProviderKind | undefined;
  switch (kind) {
    case "anthropic":
      return "string_replace";
    case "openai":
    case "deepseek":
    case "openrouter":
    case "gateway":
    case "mammouth":
    case "openai-compatible":
      return "patch";
    default:
      return "string_replace";
  }
}

/**
 * Filter edit tools so the model sees only the format it was trained on.
 * Non-edit tools are always kept.
 */
export function filterToolsForEditFormat(
  registry: ToolRegistry,
  format: EditFormat,
): ToolRegistry {
  const editTools =
    format === "patch"
      ? new Set(["edit_file"])
      : new Set(["apply_patch"]);

  return registry.filter((t) => !editTools.has(t.name));
}
