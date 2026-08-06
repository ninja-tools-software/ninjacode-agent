import type { ModelInfo, SettingsState, VsCodeApi } from "../types.js";
import { ModelMenuPopover, ModelMenuTrigger, useModelMenuState } from "./ModelMenuSections.js";

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

  const selectModel = (id: string) => {
    setSettings({ ...settings, model: id });
    vscode.postMessage({ type: "set_model", model: id });
    state.setOpen(false);
  };

  const toggleFavorite = (id: string) => {
    const next = state.favorites.includes(id)
      ? state.favorites.filter((f) => f !== id)
      : [...state.favorites, id];
    setSettings({ ...settings, favoriteModels: next });
    vscode.postMessage({ type: "set_favorite_models", models: next });
  };

  return (
    <div className="model-menu-wrap" ref={state.rootRef}>
      {state.menuPresence.mounted && (
        <ModelMenuPopover
          models={state.models}
          favorites={state.favorites}
          favoriteCount={state.favoriteCount}
          highlight={state.highlight}
          settings={settings}
          setHighlight={state.setHighlight}
          selectModel={selectModel}
          toggleFavorite={toggleFavorite}
          setOpen={state.setOpen}
          benchModelId={state.benchModelId}
          setBenchModelId={state.setBenchModelId}
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
