import { legacyRequest } from "../lib/http.js";

export function listProducts() {
  return legacyRequest("/products", {});
}
