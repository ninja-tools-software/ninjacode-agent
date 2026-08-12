import type { LogItem } from "../types.js";
import type {
  ChangeItem,
  ContextUsage,
  Hypothesis,
  PlanState,
  PlanSummary,
  QueuedMessage,
  RunState,
  SessionSummary,
  SessionUsage,
  TodoItem,
} from "../types.js";
import type { HostToWebview } from "../types.js";

export interface ChatState {
  log: LogItem[];
  todos: TodoItem[];
  plan: PlanState | null;
  plans: PlanSummary[];
  pendingEdits: string[];
  hypotheses: Hypothesis[];
  debugLogCount: number;
  runState: RunState;
  queue: QueuedMessage[];
  contextUsage: ContextUsage | null;
  sessionUsage: SessionUsage | null;
  changes: ChangeItem[];
  autoAcceptDeadline: number | null;
  hunksByPath: Record<string, import("../types.js").HunkItem[]>;
  sessions: SessionSummary[];
  activeSessionId?: string;
  sessionsLoading: boolean;
  showDragTip: boolean;
  onboardingDismissed: boolean;
}

export const initialChatState: ChatState = {
  log: [],
  todos: [],
  plan: null,
  plans: [],
  pendingEdits: [],
  hypotheses: [],
  debugLogCount: 0,
  runState: "idle",
  queue: [],
  contextUsage: null,
  sessionUsage: null,
  changes: [],
  autoAcceptDeadline: null,
  hunksByPath: {},
  sessions: [],
  activeSessionId: undefined,
  sessionsLoading: false,
  showDragTip: false,
  onboardingDismissed: false,
};

export type ChatAction =
  | { kind: "host"; message: HostToWebview }
  | { kind: "sessions_loading"; loading: boolean }
  | { kind: "dismiss_drag_tip" }
  | { kind: "dismiss_onboarding" }
  | { kind: "clear_plan" };
