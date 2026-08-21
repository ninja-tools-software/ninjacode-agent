/**
 * States the kitchen sink cannot show at the same time: the empty log, the
 * welcome screen that replaces the whole chat body, and a live run.
 */
import { mockSettings, unconfiguredSettings } from "../mockSettings.js";
import { emptyHydrate, type PreviewScenario } from "./types.js";

export const empty: PreviewScenario = {
  id: "empty",
  label: "Empty",
  settings: mockSettings(),
  hydrate: emptyHydrate({ activeSessionId: "s-new" }),
  extras: [],
};

export const onboarding: PreviewScenario = {
  id: "onboarding",
  label: "Onboarding",
  settings: unconfiguredSettings(),
  hydrate: emptyHydrate({ onboardingDismissed: false }),
  extras: [],
};

export const running: PreviewScenario = {
  id: "running",
  label: "Running",
  settings: mockSettings(),
  hydrate: emptyHydrate({
    runState: "running",
    activeSessionId: "s-theme",
    log: [
      { kind: "user", text: "Remplace les tokens lus en JS par des variables CSS." },
      {
        kind: "reasoning",
        text: "Je commence par theme.ts, c'est le seul appelant de readTokens.\nEnsuite je vérifie panel.tsx",
      },
      {
        kind: "tool",
        id: "t-edit",
        name: "edit_file",
        label: "Edit theme.ts",
        target: "src/settings/theme.ts",
        status: "running",
        argsPreview: '{"path":"src/settings/theme.ts"}',
      },
      { kind: "status", text: "Applying edits…" },
    ],
    todos: [
      { id: "t1", content: "Remplacer les tokens JS par des variables CSS", status: "in_progress" },
      { id: "t2", content: "Couvrir le changement de thème par un test", status: "pending" },
    ],
    contextUsage: {
      system: 6_400,
      history: 12_100,
      tools: 2_400,
      files: 5_800,
      output: 900,
      total: 27_600,
      window: 200_000,
    },
    sessionUsage: {
      turns: 2,
      inputTokens: 41_200,
      outputTokens: 2_910,
      cacheReadTokens: 18_000,
      cacheWriteTokens: 4_100,
      model: "claude-sonnet-4-6",
    },
  }),
  extras: [],
};
