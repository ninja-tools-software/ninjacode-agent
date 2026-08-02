/** Test-friendly sleep (real setTimeout). */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
