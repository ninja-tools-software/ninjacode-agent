import type { ToolRegistry } from "@ninjacode/tools";
import { resolveHarnessProfile, type EditFormat } from "./harnessProfiles.js";

export type { EditFormat } from "./harnessProfiles.js";

/** Resolve the edit format from the versioned harness profile. */
export function preferredEditFormat(providerKind?: string, modelId?: string): EditFormat {
  return resolveHarnessProfile({ providerKind, modelId }).editFormat;
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
