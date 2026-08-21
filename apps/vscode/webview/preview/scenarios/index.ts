import { empty, onboarding, running } from "./basics.js";
import { kitchenSink } from "./kitchenSink.js";
import type { PreviewScenario } from "./types.js";

export type { PreviewScenario } from "./types.js";

export const SCENARIOS: PreviewScenario[] = [kitchenSink, empty, onboarding, running];

export const DEFAULT_SCENARIO_ID = kitchenSink.id;

export function scenarioById(id: string | null): PreviewScenario {
  return SCENARIOS.find((s) => s.id === id) ?? kitchenSink;
}
