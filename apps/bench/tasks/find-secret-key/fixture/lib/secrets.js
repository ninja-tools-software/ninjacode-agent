import keys from "../data/keys.json" with { type: "json" };

export function resolveApiKey(env) {
  const entry = keys[env];
  if (!entry) throw new Error(`unknown env: ${env}`);
  if (entry.encoding === "base64") {
    return Buffer.from(entry.apiKey, "base64").toString("utf8");
  }
  return entry.apiKey;
}
