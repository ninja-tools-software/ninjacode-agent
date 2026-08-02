import type { ChangeItem, HunkItem, QueuedMessage, TodoItem, VsCodeApi } from "./types.js";
import { ChangesPanel } from "./panels/ChangesPanel.js";
import { QueuePanel } from "./panels/QueuePanel.js";
import { TodoList } from "./panels/TodoList.js";

export interface AppPanelsProps {
  queueMounted: boolean;
  queueClosing: boolean;
  queue: QueuedMessage[];
  changesMounted: boolean;
  changesClosing: boolean;
  changes: ChangeItem[];
  autoAcceptRemaining: number | null;
  expandedHunksPath: string | null;
  setExpandedHunksPath: (p: string | null) => void;
  hunksByPath: Record<string, HunkItem[]>;
  feedbackForPath: string | null;
  setFeedbackForPath: (p: string | null) => void;
  feedbackText: string;
  setFeedbackText: (t: string) => void;
  todosMounted: boolean;
  todosClosing: boolean;
  todos: TodoItem[];
  busy: boolean;
  onStop: () => void;
  vscode: VsCodeApi;
}

export function AppPanels(props: AppPanelsProps) {
  return (
    <>
      {props.queueMounted && (
        <QueuePanel queue={props.queue} closing={props.queueClosing} vscode={props.vscode} />
      )}
      {props.changesMounted && (
        <ChangesPanel
          changes={props.changes}
          autoAcceptRemaining={props.autoAcceptRemaining ?? 0}
          expandedHunksPath={props.expandedHunksPath}
          setExpandedHunksPath={props.setExpandedHunksPath}
          hunksByPath={props.hunksByPath}
          feedbackForPath={props.feedbackForPath}
          setFeedbackForPath={props.setFeedbackForPath}
          feedbackText={props.feedbackText}
          setFeedbackText={props.setFeedbackText}
          closing={props.changesClosing}
          vscode={props.vscode}
        />
      )}
      {props.todosMounted && (
        <TodoList
          todos={props.todos}
          closing={props.todosClosing}
          pinned
          busy={props.busy}
          onStop={props.onStop}
        />
      )}
    </>
  );
}
