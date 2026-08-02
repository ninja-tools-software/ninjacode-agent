import { createClient } from "./billing/client.js";

export function boot() {
  return createClient();
}
