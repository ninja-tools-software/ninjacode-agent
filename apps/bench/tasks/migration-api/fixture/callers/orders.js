import { legacyRequest } from "../lib/http.js";

export function createOrder(payload) {
  return legacyRequest("/orders", { method: "POST", body: payload });
}
