import { useAnimatedPresence, useAnimatedPresenceWithSnapshot } from "../hooks/useAnimatedPresence.js";
import type { QueuedMessage, TodoItem } from "../types.js";

export function useAppPresence(options: {
  historyOpen: boolean;
  plansOpen: boolean;
  pickerOpen: boolean;
  menuItemsLength: number;
  menuItems: unknown[];
  queueLength: number;
  queue: QueuedMessage[];
  busy: boolean;
  todos: TodoItem[];
  changesLength: number;
  pendingEditsLength: number;
  mode: string;
  hypothesesLength: number;
  busyForPill: boolean;
  showDragTip: boolean;
  logLength: number;
}) {
  const historyPresence = useAnimatedPresence(options.historyOpen);
  const plansPresence = useAnimatedPresence(options.plansOpen);
  const pickerPresence = useAnimatedPresence(options.pickerOpen);
  const menuPresence = useAnimatedPresenceWithSnapshot(options.menuItemsLength > 0, options.menuItems);
  const queuePresence = useAnimatedPresenceWithSnapshot(options.queueLength > 0, options.queue);
  const todosPresence = useAnimatedPresenceWithSnapshot(options.busy && options.todos.length > 0, options.todos);
  const changesPresence = useAnimatedPresence(
    options.changesLength > 0 || options.pendingEditsLength > 0,
  );
  const hypothesesPresence = useAnimatedPresence(
    options.mode === "debug" || options.hypothesesLength > 0,
  );
  const runPillPresence = useAnimatedPresence(options.busyForPill);
  const dragTipPresence = useAnimatedPresence(options.showDragTip && options.logLength > 0);

  return {
    historyPresence,
    plansPresence,
    pickerPresence,
    menuPresence,
    queuePresence,
    todosPresence,
    changesPresence,
    hypothesesPresence,
    runPillPresence,
    dragTipPresence,
  };
}
