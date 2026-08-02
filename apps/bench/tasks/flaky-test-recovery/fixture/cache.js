/** Red herring module — looks related to flakiness but is fine. */
let hits = 0;
export function touch() {
  hits += 1;
  return hits;
}
