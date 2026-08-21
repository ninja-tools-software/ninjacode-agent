/**
 * The extension host, reduced to what the chat needs to render and stay
 * clickable: replay a scenario on `ready`, and answer the handful of requests
 * whose missing reply would leave a card spinning forever.
 *
 * It is deliberately not an agent. A canned reply is enough to exercise the
 * streaming CSS (live dots, run progress, cursor); anything more would drift
 * from the real host without adding styling coverage.
 */
import type { ContextRef, HostToWebview, WebviewToHost } from "../src/chat/types.js";
import type { PreviewScenario } from "./scenarios/index.js";

export type Post = (msg: HostToWebview) => void;
export type UiLocale = "en" | "fr";

interface HostState {
  scenario: PreviewScenario;
  locale: UiLocale;
  timers: number[];
}

export interface MockHost {
  /** Replay `settings`, `hydrate` and the scenario panels, in that order. */
  replay: () => void;
  handle: (msg: WebviewToHost) => void;
  setScenario: (scenario: PreviewScenario) => void;
  setLocale: (locale: UiLocale) => void;
}

type Handler = (msg: WebviewToHost, post: Post, state: HostState) => void;

function extraOfType<T extends HostToWebview["type"]>(
  state: HostState,
  type: T,
): Extract<HostToWebview, { type: T }> | undefined {
  return state.scenario.extras.find((m) => m.type === type) as
    | Extract<HostToWebview, { type: T }>
    | undefined;
}

const REPLY = [
  "Les tokens sont maintenant lus depuis la cascade CSS, donc le panneau suit le",
  "thème actif sans aller-retour avec le host.",
].join(" ");

/** Canned turn: enough streaming to judge the live states, nothing more. */
function replyToUserMessage(post: Post, state: HostState): void {
  const steps: Array<[number, HostToWebview]> = [
    [0, { type: "run_state", state: "running" }],
    [120, { type: "status", text: "Thinking…" }],
    [260, { type: "reasoning_delta", text: "Le panneau relit les tokens à chaque render. " }],
    [420, { type: "reasoning_delta", text: "Je vérifie la cascade CSS." }],
    [700, { type: "assistant_delta", text: `${REPLY.slice(0, 48)}` }],
    [900, { type: "assistant_delta", text: REPLY.slice(48) }],
    [1_000, { type: "assistant_done" }],
    [1_020, { type: "run_state", state: "completed" }],
  ];
  for (const [delay, msg] of steps) {
    state.timers.push(window.setTimeout(() => post(msg), delay));
  }
}

const lifecycle: Record<string, Handler> = {
  get_settings: (_msg, post, state) =>
    post({ type: "settings", ...state.scenario.settings, locale: state.locale }),
  new_session: (_msg, post) => post({ type: "clear" }),
  list_sessions: (_msg, post, state) =>
    post({
      type: "sessions",
      sessions: state.scenario.hydrate.sessions,
      activeSessionId: state.scenario.hydrate.activeSessionId,
    }),
  switch_session: (msg, post) =>
    post({ type: "session_changed", activeSessionId: (msg as { sessionId: string }).sessionId }),
  stop: (_msg, post) => post({ type: "run_state", state: "stopped" }),
  user_message: (_msg, post, state) => replyToUserMessage(post, state),
  list_plans: (_msg, post, state) => {
    const plans = extraOfType(state, "plans");
    if (plans) post(plans);
  },
  get_hunks: (msg, post, state) => {
    const path = (msg as { path: string }).path;
    const hunks = extraOfType(state, "hunks");
    post({ type: "hunks", path, hunks: hunks?.path === path ? hunks.hunks : [] });
  },
};

const cards: Record<string, Handler> = {
  approve: (msg, post) =>
    post({ type: "approval_resolved", requestId: requestId(msg), approved: true }),
  approve_always: (msg, post) =>
    post({ type: "approval_resolved", requestId: requestId(msg), approved: true, remember: true }),
  deny: (msg, post) =>
    post({ type: "approval_resolved", requestId: requestId(msg), approved: false }),
  question_answer: (msg, post) => {
    const m = msg as Extract<WebviewToHost, { type: "question_answer" }>;
    post({ type: "question_resolved", requestId: m.requestId, answers: m.answers });
  },
  user_action_done: (msg, post) => {
    const m = msg as Extract<WebviewToHost, { type: "user_action_done" }>;
    post({ type: "user_action_resolved", requestId: m.requestId, comment: m.comment });
  },
};

function requestId(msg: WebviewToHost): string {
  return (msg as { requestId?: string }).requestId ?? "";
}

function suggestion(id: string, label: string, detail?: string) {
  return { id, label, detail };
}

const SUGGESTIONS = [
  suggestion("src/settings/theme.ts", "theme.ts", "src/settings/theme.ts"),
  suggestion("src/panel.tsx", "panel.tsx", "src/panel.tsx"),
  suggestion("src/styles/tokens.css", "tokens.css", "src/styles/tokens.css"),
];

function fakeRef(target: string, label: string): ContextRef {
  return { id: `file:${target}`, kind: "file", label, target, status: "resolved", tokens: 640 };
}

const composerHandlers: Record<string, Handler> = {
  mention_query: (_msg, post) =>
    post({ type: "mention_suggestions", items: SUGGESTIONS.map((s) => s.id) }),
  context_query: (msg, post) => {
    const m = msg as Extract<WebviewToHost, { type: "context_query" }>;
    post({ type: "context_suggestions", queryType: m.queryType, items: SUGGESTIONS });
  },
  resolve_context_item: (msg, post) => {
    const m = msg as Extract<WebviewToHost, { type: "resolve_context_item" }>;
    post({
      type: "context_resolved",
      requestId: m.requestId,
      ref: fakeRef(m.contextId, m.contextLabel ?? m.contextId),
    });
  },
  get_current_selection: (msg, post) =>
    post({
      type: "context_resolved",
      requestId: requestId(msg),
      ref: fakeRef("src/panel.tsx:40", "panel.tsx:40-58"),
    }),
  resolve_refs: (msg, post) => {
    const m = msg as Extract<WebviewToHost, { type: "resolve_refs" }>;
    post({ type: "refs_resolved", requestId: m.requestId, refs: m.refs });
  },
  resolve_drop: (msg, post) =>
    post({
      type: "refs_resolved",
      requestId: requestId(msg),
      refs: [fakeRef("src/settings/theme.ts", "theme.ts")],
    }),
  pick_files_native: (msg, post) =>
    post({ type: "refs_resolved", requestId: requestId(msg), refs: [] }),
  ref_preview: (msg, post) =>
    post({
      type: "ref_preview_result",
      requestId: requestId(msg),
      preview: "export function usePanelTheme() {\n  return readTokens();\n}",
      tokens: 640,
    }),
  enhance_prompt: (msg, post) => {
    const m = msg as Extract<WebviewToHost, { type: "enhance_prompt" }>;
    post({ type: "enhance_prompt_result", requestId: m.requestId, text: `${m.text} (enhanced)` });
  },
  voice_start: (_msg, post) =>
    post({ type: "voice_error", text: "Voice dictation needs the extension host." }),
};

const HANDLERS: Record<string, Handler> = { ...lifecycle, ...cards, ...composerHandlers };

const PANEL_RESETS: HostToWebview[] = [
  { type: "changes", changes: [] },
  { type: "plans", items: [] },
  { type: "auto_accept", deadline: null },
];

export function createMockHost(
  post: Post,
  scenario: PreviewScenario,
  locale: UiLocale = "en",
): MockHost {
  const state: HostState = { scenario, locale, timers: [] };

  const clearTimers = () => {
    for (const id of state.timers) clearTimeout(id);
    state.timers = [];
  };

  const replay = () => {
    clearTimers();
    post({ type: "settings", ...state.scenario.settings, locale: state.locale });
    post({ type: "hydrate", ...state.scenario.hydrate });
    // `hydrate` does not own these panels, so without an explicit reset they
    // would survive a scenario switch and show the previous scenario's data.
    for (const msg of PANEL_RESETS) post(msg);
    for (const msg of state.scenario.extras) post(msg);
  };

  return {
    replay,
    handle: (msg) => {
      if (msg.type === "ready") {
        replay();
        return;
      }
      HANDLERS[msg.type]?.(msg, post, state);
    },
    setScenario: (next) => {
      state.scenario = next;
      replay();
    },
    setLocale: (next) => {
      state.locale = next;
      post({ type: "set_locale", locale: next });
    },
  };
}
