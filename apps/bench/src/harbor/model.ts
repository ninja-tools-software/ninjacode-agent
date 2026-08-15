/** Split Harbor `-m provider/model` into NinjaCode `--provider` / `--model`. */
export function parseHarborModel(
  modelName: string | undefined | null,
): { provider?: string; model?: string } {
  if (!modelName) return {};
  if (modelName.includes("/")) {
    const slash = modelName.indexOf("/");
    const provider = modelName.slice(0, slash);
    const model = modelName.slice(slash + 1);
    return {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    };
  }
  return { model: modelName };
}
