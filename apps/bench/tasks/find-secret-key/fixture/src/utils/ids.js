export function makeId(prefix) {
  return `${prefix}_${Date.now()}`;
}
