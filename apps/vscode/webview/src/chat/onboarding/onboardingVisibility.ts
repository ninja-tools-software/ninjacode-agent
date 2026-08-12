import type { SettingsState } from "../types.js";

/** Providers that answer without a key, so their users never need the welcome screen. */
const KEYLESS_PROVIDERS = ["local", "mock"];

/**
 * The welcome screen takes over the chat only while the user has no way to talk
 * to a model: no gateway session, and no API key on any real provider.
 */
export function needsGatewayOnboarding(settings: SettingsState | null): boolean {
  // Settings arrive one message after `hydrate`; assuming "not configured" here
  // would flash the welcome screen on every reload.
  if (!settings) return false;
  if (settings.gatewayConfigured) return false;
  if (KEYLESS_PROVIDERS.includes(settings.provider)) return false;
  return !Object.entries(settings.hasApiKey ?? {}).some(
    ([kind, configured]) =>
      configured && kind !== "gateway" && !KEYLESS_PROVIDERS.includes(kind),
  );
}
