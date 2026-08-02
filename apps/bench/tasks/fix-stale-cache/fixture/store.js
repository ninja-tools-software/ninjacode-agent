/** Simple key-value store with optional TTL cache. */
const data = new Map();
const cache = new Map();

export function set(key, value) {
  data.set(key, value);
  // BUG: writes through to data but leaves a stale cache entry
}

export function del(key) {
  data.delete(key);
  // BUG: does not drop the cached value either
}

export function get(key) {
  if (cache.has(key)) return cache.get(key);
  if (!data.has(key)) return undefined;
  const value = data.get(key);
  cache.set(key, value);
  return value;
}

export function clearCache() {
  cache.clear();
}

export function _reset() {
  data.clear();
  cache.clear();
}
