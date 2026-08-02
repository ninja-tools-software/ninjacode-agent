import { useCallback, useMemo, useState } from "react";
import type { ContextQueryType, ContextRef, ContextSuggestion, VsCodeApi } from "../types.js";

interface PickerQueueHandlers {
  place: (requestId: string, incoming: ContextRef[]) => void;
  queueContextPick: (pickerType: ContextQueryType, item: { id: string; label: string }) => void;
  queueSelectionPick: () => void;
  queueFilesPick: () => void;
}

function usePickerState(vscode: VsCodeApi) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerType, setPickerType] = useState<ContextQueryType>("file");
  const [pickerQuery, setPickerQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ContextSuggestion[]>([]);

  const queryContext = useCallback(
    (type: ContextQueryType, query: string) =>
      vscode.postMessage({ type: "context_query", queryType: type, query }),
    [vscode],
  );

  const openPicker = useCallback(
    (type: ContextQueryType) => {
      setPickerOpen(true);
      setPickerType(type);
      setPickerQuery("");
      setSuggestions([]);
      queryContext(type, "");
    },
    [queryContext],
  );

  return {
    pickerOpen,
    setPickerOpen,
    pickerType,
    pickerQuery,
    setPickerQuery,
    suggestions,
    setSuggestions,
    openPicker,
    queryContext,
  };
}

export function useComposerPicker(vscode: VsCodeApi, handlers: PickerQueueHandlers) {
  const state = usePickerState(vscode);

  const onContextResolved = useCallback(
    (requestId: string, ref: ContextRef | null) => {
      state.setPickerOpen(false);
      handlers.place(requestId, ref ? [ref] : []);
    },
    [handlers, state.setPickerOpen],
  );

  const picker = useMemo(
    () => ({
      open: state.pickerOpen,
      type: state.pickerType,
      query: state.pickerQuery,
      suggestions: state.suggestions,
      toggle: () => (state.pickerOpen ? state.setPickerOpen(false) : state.openPicker(state.pickerType)),
      close: () => state.setPickerOpen(false),
      setType: (t: ContextQueryType) => state.openPicker(t),
      setQuery: (q: string) => {
        state.setPickerQuery(q);
        state.queryContext(state.pickerType, q);
      },
      pick: (item: ContextSuggestion) => handlers.queueContextPick(state.pickerType, item),
      addSelection: () => {
        handlers.queueSelectionPick();
        state.setPickerOpen(false);
      },
      pickFiles: () => {
        handlers.queueFilesPick();
        state.setPickerOpen(false);
      },
      onSuggestions: (queryType: ContextQueryType, items: ContextSuggestion[]) => {
        if (queryType === state.pickerType || !state.pickerOpen) state.setSuggestions(items);
      },
    }),
    [handlers, state],
  );

  return { picker, onContextResolved, onRefsResolved: handlers.place };
}
