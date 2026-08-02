import { legacyRequest } from "../lib/http.js";

export function sendNotify(msg) {
  return legacyRequest("/notify", { method: "POST", body: { msg } });
}
