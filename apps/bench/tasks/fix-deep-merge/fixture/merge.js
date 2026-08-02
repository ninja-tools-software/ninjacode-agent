/**
 * Deep-merge `source` into `target` (returns a new object).
 * Rules expected by tests:
 * - plain objects are merged recursively
 * - arrays are replaced (not concatenated, not merged by index)
 * - undefined in source does not overwrite
 * - null in source does overwrite
 * - keys "__proto__", "prototype", "constructor" in source are ignored
 * - Date / RegExp are cloned by value (not merged as objects)
 */
export function deepMerge(target, source) {
  if (source === null || typeof source !== "object") return source;
  if (Array.isArray(source)) return source.slice();
  // Looks recursive but still wrong on several edge cases the tests cover.
  const out = Array.isArray(target) ? target.slice() : { ...(target && typeof target === "object" ? target : {}) };
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    // BUG: does not filter dangerous keys
    const tv = out[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      // BUG: Date/RegExp treated as plain objects
      out[k] = deepMerge(tv, v);
    } else if (Array.isArray(v) && Array.isArray(tv)) {
      // BUG: concatenates arrays instead of replacing
      out[k] = tv.concat(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
