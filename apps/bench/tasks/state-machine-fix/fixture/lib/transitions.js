/** Legal transitions: from -> set of to */
export const TRANSITIONS = {
  draft: new Set(["submitted"]),
  submitted: new Set(["paid", "cancelled"]),
  paid: new Set(["shipped"]),
  shipped: new Set(["delivered"]),
  cancelled: new Set(),
  delivered: new Set(),
};

export function canTransition(from, to) {
  // BUG: allows any transition if `to` exists as a key, ignoring the map
  return Object.hasOwn(TRANSITIONS, to);
}
