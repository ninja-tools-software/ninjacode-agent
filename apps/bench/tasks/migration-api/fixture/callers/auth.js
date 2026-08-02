import { legacyRequest } from "../lib/http.js";

export function login(creds) {
  return legacyRequest("/auth/login", { method: "POST", body: creds });
}
