/**
 * Detect a NinjaCode gateway "out of credits" failure.
 * Match the typed error code only — bare HTTP 402 also appears on upstream
 * provider failures (e.g. OpenRouter) and must not be treated as the user's
 * NinjaCode balance being empty.
 */
export function isGatewayCreditsError(message: string): boolean {
  return message.includes("insufficient_credits");
}
