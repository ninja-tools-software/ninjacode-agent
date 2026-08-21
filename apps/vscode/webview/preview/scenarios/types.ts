import type { HostToWebview, HydratePayload, SettingsPayload } from "../../../src/protocol.js";

/**
 * One reproducible chat state. `hydrate` is what the host replays on reload;
 * `extras` carries the panels that live outside `HydratePayload` (plan, changes,
 * hunks, slash commands) and must therefore be sent after it.
 */
export interface PreviewScenario {
  id: string;
  label: string;
  settings: SettingsPayload;
  hydrate: HydratePayload;
  extras: HostToWebview[];
}

/** Defaults for the fields a scenario does not care about. */
export function emptyHydrate(overrides: Partial<HydratePayload> = {}): HydratePayload {
  return {
    log: [],
    todos: [],
    pendingEdits: [],
    hypotheses: [],
    debugLogCount: 0,
    sessions: [],
    runState: "idle",
    queue: [],
    contextUsage: null,
    sessionUsage: null,
    showDragTip: false,
    onboardingDismissed: true,
    ...overrides,
  };
}
