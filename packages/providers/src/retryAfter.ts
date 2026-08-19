/**
 * `Retry-After` is either delay-seconds or an HTTP date. Anything else, or a date
 * already in the past, means the header tells us nothing and the caller should
 * fall back to its own backoff curve.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/u.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return at > now ? at - now : undefined;
}
