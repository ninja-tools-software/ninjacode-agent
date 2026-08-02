import { legacyRequest } from "../lib/http.js";

export function charge(amount) {
  return legacyRequest("/billing/charge", { method: "POST", body: { amount } });
}
