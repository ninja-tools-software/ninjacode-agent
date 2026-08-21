import type { HostToWebview } from "../../../src/protocol.js";
import { mockSettings } from "../mockSettings.js";
import { KITCHEN_SINK_LOG } from "./kitchenSinkLog.js";
import { emptyHydrate, type PreviewScenario } from "./types.js";

const PLAN_CONTENT = [
  "# Thème du panneau de paramètres",
  "",
  "## Étapes",
  "",
  "1. Remplacer les tokens lus en JS par des variables CSS.",
  "2. Supprimer `usePanelTheme` et ses appelants.",
  "3. Couvrir le changement de thème par un test.",
].join("\n");

const PANELS: HostToWebview[] = [
  {
    type: "plan",
    planId: "plan-theme-01",
    title: "Thème du panneau de paramètres",
    path: ".ninjacode/plans/plan-theme-01.md",
    content: PLAN_CONTENT,
  },
  {
    type: "plans",
    items: [
      {
        id: "plan-theme-01",
        title: "Thème du panneau de paramètres",
        relPath: ".ninjacode/plans/plan-theme-01.md",
        preview: "Remplacer les tokens lus en JS par des variables CSS.",
        createdAt: "2026-08-20T09:12:00.000Z",
        updatedAt: "2026-08-21T08:04:00.000Z",
        sessionId: "s-theme",
      },
      {
        id: "plan-voice-04",
        title: "Dictée vocale hors du webview",
        relPath: ".ninjacode/plans/plan-voice-04.md",
        preview: "Déplacer l'enregistrement côté host, le webview n'a pas de micro.",
        createdAt: "2026-08-11T16:40:00.000Z",
        updatedAt: "2026-08-12T10:02:00.000Z",
        sessionId: "s-voice",
      },
    ],
  },
  {
    type: "changes",
    changes: [
      { path: "src/settings/theme.css", additions: 34, deletions: 0, sensitive: false, sessionId: "s-theme" },
      { path: "src/settings/theme.ts", additions: 6, deletions: 41, sensitive: false, sessionId: "s-theme" },
      { path: ".env.local", additions: 1, deletions: 1, sensitive: true, sessionId: "s-theme" },
    ],
  },
  {
    type: "hunks",
    path: "src/settings/theme.ts",
    hunks: [
      {
        id: "h1",
        currentStart: 10,
        currentLines: [
          "export function usePanelTheme() {",
          "  const [tokens] = useState(readTokens);",
          "  return tokens;",
          "}",
        ],
        afterStart: 10,
        afterLines: ["/* Les tokens vivent dans theme.css : la cascade suit le thème actif. */"],
      },
    ],
  },
  { type: "auto_accept", deadline: null },
  {
    type: "slash_commands",
    builtins: [
      { name: "clear", description: "Start a new session" },
      { name: "compact", description: "Compact the conversation" },
    ],
    prompts: [
      { name: "review", description: "Review the working tree", argumentHint: "[path]" },
      { name: "changelog", description: "Draft a changelog entry" },
    ],
  },
];

/** Everything at once: the reference surface for a CSS change. */
export const kitchenSink: PreviewScenario = {
  id: "kitchen-sink",
  label: "Kitchen sink",
  settings: mockSettings(),
  hydrate: emptyHydrate({
    log: KITCHEN_SINK_LOG,
    todos: [
      { id: "t1", content: "Lire usePanelTheme et repérer la lecture unique", status: "completed" },
      { id: "t2", content: "Remplacer les tokens JS par des variables CSS", status: "in_progress" },
      { id: "t3", content: "Couvrir le changement de thème par un test", status: "pending" },
      { id: "t4", content: "Ajouter un événement host onDidChangeActiveColorTheme", status: "cancelled" },
    ],
    pendingEdits: ["src/settings/theme.css", "src/settings/theme.ts"],
    hypotheses: [
      { id: "h1", description: "Les tokens sont lus une seule fois au montage", status: "confirmed" },
      { id: "h2", description: "Le host ne republie pas le thème après changement", status: "open" },
      { id: "h3", description: "Le cache CSS du webview garde l'ancienne feuille", status: "rejected" },
    ],
    debugLogCount: 7,
    activeSessionId: "s-theme",
    sessions: [
      {
        id: "s-theme",
        title: "Thème du panneau",
        mode: "agent",
        model: "claude-sonnet-4-6",
        provider: "gateway",
        createdAt: "2026-08-21T07:40:00.000Z",
        updatedAt: "2026-08-21T08:31:00.000Z",
        turnCount: 6,
        preview: "Le panneau de paramètres garde le thème clair…",
        pinned: true,
        archived: false,
        totalUsage: { inputTokens: 184_320, outputTokens: 12_480, cacheReadTokens: 96_000, cacheWriteTokens: 8_200 },
      },
      {
        id: "s-voice",
        title: "Dictée vocale",
        mode: "plan",
        model: "gpt-5-6-sol",
        provider: "gateway",
        createdAt: "2026-08-12T09:02:00.000Z",
        updatedAt: "2026-08-12T10:02:00.000Z",
        turnCount: 2,
        preview: "Le micro n'est pas accessible depuis le webview…",
        pinned: false,
        archived: false,
        totalUsage: { inputTokens: 24_100, outputTokens: 3_050, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ],
    queue: [
      { id: "q1", text: "Ajoute aussi le mode contraste élevé", mode: "agent", queuedAt: 1_787_000_000_000 },
      { id: "q2", text: "Puis lance pnpm lint", mode: "agent", queuedAt: 1_787_000_060_000 },
    ],
    contextUsage: {
      system: 6_400,
      history: 38_200,
      tools: 9_100,
      files: 14_600,
      output: 3_200,
      total: 71_500,
      window: 200_000,
    },
    sessionUsage: {
      turns: 6,
      inputTokens: 184_320,
      outputTokens: 12_480,
      cacheReadTokens: 96_000,
      cacheWriteTokens: 8_200,
      model: "auto",
      resolvedModel: "claude-sonnet-4-6",
    },
    showDragTip: true,
  }),
  extras: PANELS,
};
