import { legacyRequest } from "../lib/http.js";

export function search(q) {
  return legacyRequest(`/search?q=${q}`, { method: "GET" });
}
