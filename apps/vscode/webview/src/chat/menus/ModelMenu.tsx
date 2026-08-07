import type { ModelInfo, SettingsState, VsCodeApi } from "../types.js";
import {
  ModelMenuPopover,
  ModelMenuTrigger,
  useModelMenuActions,
  useModelMenuState,
} from "./ModelMenuSections.js";

export function ModelMenu({
  settings,
  vscode,
  setSettings,
  open,
  onOpenChange,
}: {
  settings: SettingsState;
  modelInfo?: ModelInfo;
  vscode: VsCodeApi;
  setSettings: (s: SettingsState) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useModelMenuState(settings, open, onOpenChange);
  const { selectModel, toggleFavorite, onSort } = useModelMenuActions(
    settings,
    setSettings,
    vscode,
    state,
  );

  return (
    <div className="model-menu-wrap" ref={state.rootRef}>
      {state.menuPresence.mounted && (
        <ModelMenuPopover
          models={state.models}
          favorites={state.favorites}
          favoriteCount={state.favoriteCount}
          highlight={state.highlight}
          settings={settings}
          showMetrics={state.showMetrics}
          sort={state.sort}
          setHighlight={state.setHighlight}
          selectModel={selectModel}
          toggleFavorite={toggleFavorite}
          setOpen={state.setOpen}
          benchModelId={state.benchModelId}
          setBenchModelId={state.setBenchModelId}
          onSort={onSort}
          closing={state.menuPresence.closing}
        />
      )}
      <ModelMenuTrigger
        open={state.open}
        label={state.active?.label ?? settings.model}
        models={state.models}
        settings={settings}
        highlight={state.highlight}
        setHighlight={state.setHighlight}
        setOpen={state.setOpen}
        selectModel={selectModel}
      />
    </div>
  );
}
