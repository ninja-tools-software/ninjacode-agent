import { legacyFormat } from "../utils/format.js";

export function orderLabel(order) {
  return legacyFormat(order.sku);
}
