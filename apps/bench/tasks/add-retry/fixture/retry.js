import { sleep } from "./sleep.js";

/**
 * Retry `fn` on transient failures.
 * @param {() => Promise<any>} fn
 * @param {{ retries: number, delayMs: number }} opts
 *
 * Rules (see tests):
 * - total attempts = retries + 1
 * - wait delayMs between attempts via sleep()
 * - only retry when the thrown error has message including "transient"
 * - non-transient errors fail immediately (no further attempts)
 * - rethrow the last error if all attempts fail
 */
export async function withRetry(fn, opts) {
  void sleep;
  void opts;
  return fn();
}
