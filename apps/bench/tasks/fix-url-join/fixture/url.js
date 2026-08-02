/**
 * Join a base URL with path parts.
 * - Collapse duplicate slashes in the path (not after the scheme).
 * - Preserve query string and hash from the base (reattach after path join).
 * - If a part is an absolute URL (http/https), it replaces the base entirely
 *   and subsequent parts join onto it.
 * - Empty parts are skipped.
 */
export function joinUrl(base, ...parts) {
  let url = base;
  for (const p of parts) {
    if (!p) continue;
    // BUG: absolute URL parts do not reset the base
    // BUG: query/hash are not stripped before joining, then reattached
    const left = url.replace(/\/+$/, "");
    const right = String(p).replace(/^\/+/, "");
    url = left + "/" + right;
  }
  // BUG: does not collapse accidental double slashes in path
  return url;
}
