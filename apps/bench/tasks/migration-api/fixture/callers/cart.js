import { legacyRequest } from "../lib/http.js";

export function addToCart(item) {
  return legacyRequest("/cart", { method: "POST", body: item });
}
