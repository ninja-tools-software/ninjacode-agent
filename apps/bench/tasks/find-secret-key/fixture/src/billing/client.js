import { resolveApiKey } from "../../lib/secrets.js";

export function createClient() {
  const key = resolveApiKey("production");
  return { keyPrefix: key.slice(0, 7) };
}
