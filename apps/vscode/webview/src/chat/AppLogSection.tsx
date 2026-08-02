import type { RefObject } from "react";
import { docFromText } from "./composer/model.js";
import type { ComposerHandle } from "./composer/Composer.js";
import { ChatLog } from "./log/ChatLog.js";
import { hasWritePlanInLog } from "./log/planCardMarks.js";
import { LogEmptyState } from "./LogEmptyState.js";
import { HypothesesPanel } from "./panels/HypothesesPanel.js";
import { PlanCard } from "./panels/PlanCard.js";
import { RunPill } from "./RunPill.js";
import { ScrollToBottomButton } from "./ScrollToBottomButton.js";
import type {
  Hypothesis,
  LogItem,
  PlanState,
  RunState,
  SettingsState,
  TodoItem,
  VsCodeApi,
} from "./types.js";

interface AppLogSectionProps {
  logRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  stuck: boolean;
  hasNewContent: boolean;
  onScrollToBottom: () => void;
  runState: RunState;
  runPillMounted: boolean;
  runPillClosing: boolean;
  onStop: () => void;
  log: LogItem[];
  composer: {
    composerRef: RefObject<ComposerHandle | null>;
    hasContent: boolean;
    setDoc: (doc: ReturnType<typeof docFromText>, caret: number) => void;
  };
  hypotheses: Hypothesis[];
  debugLogCount: number;
  hypothesesMounted: boolean;
  hypothesesClosing: boolean;
  busy: boolean;
  agentActive: boolean;
  activeSessionId?: string;
  plan: PlanState | null;
  todos: TodoItem[];
  settings: SettingsState | null;
  vscode: VsCodeApi;
}

export function AppLogSection({
  logRef,
  contentRef,
  stuck,
  hasNewContent,
  onScrollToBottom,
  runState,
  runPillMounted,
  runPillClosing,
  onStop,
  log,
  composer,
  hypotheses,
  debugLogCount,
  hypothesesMounted,
  hypothesesClosing,
  busy,
  agentActive,
  activeSessionId,
  plan,
  todos,
  settings,
  vscode,
}: AppLogSectionProps) {
  return (
    <div className="app-log-wrap">
      <div className="run-pill-overlay">
        <RunPill runState={runState} mounted={runPillMounted} closing={runPillClosing} onStop={onStop} />
      </div>
      <div id="log" ref={logRef} tabIndex={-1}>
        <div className="log-content" ref={contentRef}>
          {log.length === 0 && <LogEmptyState {...composer} />}
          {hypothesesMounted && (
            <HypothesesPanel hypotheses={hypotheses} debugLogCount={debugLogCount} closing={hypothesesClosing} />
          )}
          <ChatLog
            log={log}
            busy={busy}
            agentActive={agentActive}
            activeSessionId={activeSessionId}
            plan={plan}
            todos={todos}
            settings={settings}
            vscode={vscode}
          />
          {plan && !hasWritePlanInLog(log) && (
            <PlanCard plan={plan} todos={todos} busy={busy} settings={settings} vscode={vscode} showTodos={!busy} />
          )}
        </div>
      </div>
      <ScrollToBottomButton visible={!stuck} hasNewContent={hasNewContent} onClick={onScrollToBottom} />
    </div>
  );
}
