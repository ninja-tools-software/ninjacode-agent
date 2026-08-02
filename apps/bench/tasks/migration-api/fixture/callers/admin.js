import { legacyRequest } from "../lib/http.js";

export function adminPing() {
  return legacyRequest("/admin/ping", { method: "GET" });
}
