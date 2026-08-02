import { legacyRequest } from "../lib/http.js";

export function fetchUser(id) {
  return legacyRequest(`/users/${id}`, { method: "GET" });
}
