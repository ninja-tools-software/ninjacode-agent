import { legacyFormat } from "../utils/format.js";

export function userLabel(user) {
  return legacyFormat(user.name);
}
