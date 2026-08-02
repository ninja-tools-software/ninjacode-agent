import { legacyRequest } from "../lib/http.js";

export function health() {
  return legacyRequest("/health", {});
}
