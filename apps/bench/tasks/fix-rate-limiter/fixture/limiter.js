/**
 * Token-bucket rate limiter.
 * @param {{ capacity: number, refillPerSec: number, clock: () => number }} opts
 * capacity = max tokens (burst). refillPerSec = tokens added per second.
 * allow(cost=1) consumes `cost` tokens if available and returns true; else false.
 * Tokens refill continuously based on elapsed time from clock() (ms).
 */
export function createLimiter({ capacity, refillPerSec, clock }) {
  let tokens = capacity;
  let last = clock();

  function refill() {
    const now = clock();
    const elapsedSec = (now - last) / 1000;
    // BUG: multiplies by 1000 (treats ms as already-seconds) and forgets to move `last`
    tokens = Math.min(capacity, tokens + elapsedSec * refillPerSec * 1000);
  }

  return {
    allow(cost = 1) {
      refill();
      // BUG: rejects when tokens === cost (should allow exact balance)
      if (tokens <= cost) return false;
      tokens -= cost;
      return true;
    },
    tokens() {
      refill();
      return tokens;
    },
  };
}
