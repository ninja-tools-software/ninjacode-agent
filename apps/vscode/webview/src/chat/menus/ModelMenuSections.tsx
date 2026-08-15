import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { animCls, useAnimatedPresence } from "../hooks/useAnimatedPresence.js";
import { useDismiss } from "../hooks/useDismiss.js";
import type { ModelInfo, ModelSortId, SettingsState, VsCodeApi } from "../types.js";
import { ModelBenchmarkPanel } from "./ModelBenchmarkPanel.js";
import {
  defaultContextWindow,
  orderModels,
} from "./modelMenuHelpers.js";
import { ModelMenuListSection } from "./modelMenuRows.js";
import type { ModelSortColumn } from "./modelSort.js";
import { parseModelSort, sortModels, toggleSort } from "./modelSort.js";

type ModelMenuPopoverProps = {
  models: ModelInfo[];
  favorites: string[];
  favoriteCount: number;
  highlight: number;
  settings: SettingsState;
  showMetrics: boolean;
  sort: ModelSortId;
  setHighlight: (i: number) => void;
  selectModel: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setOpen: (open: boolean) => void;
  benchModelId: string | null;
  setBenchModelId: (id: string | null) => void;
  onSort: (column: ModelSortColumn) => void;
  closing?: boolean;
};

export function ModelMenuPopover({
  models,
  favorites,
  favoriteCount,
  highlight,
  settings,
  showMetrics,
  sort,
  setHighlight,
  selectModel,
  toggleFavorite,
  setOpen,
  benchModelId,
  setBenchModelId,
  onSort,
  closing,
}: ModelMenuPopoverProps) {
  const benchModel = benchModelId ? models.find((m) => m.id === benchModelId) : undefined;
  return (
    <div className={animCls("model-menu anim-pop anim-pop-origin-bottom", closing && "anim-closing")}>
      {benchModel ? (
        <ModelBenchmarkPanel
          model={benchModel}
          attribution={settings.benchmarkAttribution}
          onBack={() => setBenchModelId(null)}
        />
      ) : (
        <ModelMenuListSection
          models={models}
          favorites={favorites}
          favoriteCount={favoriteCount}
          highlight={highlight}
          settings={settings}
          showMetrics={showMetrics}
          sort={sort}
          setHighlight={setHighlight}
          selectModel={selectModel}
          toggleFavorite={toggleFavorite}
          setOpen={setOpen}
          openBenchmark={setBenchModelId}
          onSort={onSort}
        />
      )}
    </div>
  );
}

export function ModelMenuTrigger({
  open,
  label,
  models,
  settings,
  highlight,
  setHighlight,
  setOpen,
  selectModel,
}: {
  open: boolean;
  label: string;
  models: ModelInfo[];
  settings: SettingsState;
  highlight: number;
  setHighlight: (i: number) => void;
  setOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  selectModel: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="composer-pill model-menu-btn"
      data-tooltip={t("Model")}
      aria-expanded={open}
      onClick={() => {
        setHighlight(models.findIndex((m) => m.id === settings.model));
        setOpen((v) => !v);
      }}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          setHighlight((highlight + delta + models.length) % models.length);
        }
        if (e.key === "Enter" && highlight >= 0 && models[highlight]) {
          e.preventDefault();
          selectModel(models[highlight].id);
          setOpen(false);
        }
      }}
    >
      <span className="model-menu-btn-label">{label}</span>
      <ChevronDownIcon size={12} />
    </button>
  );
}

/** Favorites-pinned, sorted model list plus the derived sort/visibility flags it depends on. */
function useSortedModelList(settings: SettingsState) {
  const favorites = settings.favoriteModels ?? [];
  const showMetrics = settings.provider === "gateway";
  const sort = parseModelSort(settings.modelSort);
  const models = useMemo(() => {
    const base = showMetrics ? sortModels(settings.models, sort) : settings.models;
    return orderModels(base, favorites);
  }, [settings.models, favorites, showMetrics, sort]);
  const favoriteCount = models.filter((m) => favorites.includes(m.id)).length;
  return { favorites, showMetrics, sort, models, favoriteCount };
}

export function useModelMenuState(
  settings: SettingsState,
  controlledOpen?: boolean,
  onOpenChange?: (open: boolean) => void,
) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [benchModelId, setBenchModelId] = useState<string | null>(null);
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (controlledOpen === undefined) setInternalOpen(value);
    if (!value) setBenchModelId(null);
    onOpenChange?.(value);
  };
  const [highlight, setHighlight] = useState(-1);
  const menuPresence = useAnimatedPresence(open);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  useEffect(() => {
    if (controlledOpen === false) {
      setInternalOpen(false);
      setBenchModelId(null);
    }
  }, [controlledOpen]);

  useEffect(() => {
    if (open) setBenchModelId(null);
  }, [open]);

  // Capture Escape before useDismiss so drill-down goes back instead of closing.
  useEffect(() => {
    if (!open || !benchModelId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setBenchModelId(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, benchModelId]);

  const { favorites, showMetrics, sort, models, favoriteCount } = useSortedModelList(settings);
  const active = settings.models.find((m) => m.id === settings.model);

  return {
    open,
    setOpen,
    highlight,
    setHighlight,
    menuPresence,
    rootRef,
    favorites,
    models,
    favoriteCount,
    active,
    benchModelId,
    setBenchModelId,
    showMetrics,
    sort,
  };
}

/** Mutations the model menu triggers: pick a model, star it, or resort a column. */
export function useModelMenuActions(
  settings: SettingsState,
  setSettings: (s: SettingsState) => void,
  vscode: VsCodeApi,
  state: Pick<ReturnType<typeof useModelMenuState>, "favorites" | "sort" | "setOpen">,
) {
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

  const onSort = (column: ModelSortColumn) => {
    const next = toggleSort(state.sort, column);
    setSettings({ ...settings, modelSort: next });
    vscode.postMessage({ type: "set_model_sort", sort: next });
  };

  return { selectModel, toggleFavorite, onSort };
}

export function contextWindowOptions(settings: SettingsState, modelInfo?: ModelInfo): number[] {
  const ctxOptions = [...settings.contextPresets];
  if (modelInfo && !ctxOptions.includes(modelInfo.contextWindow)) {
    ctxOptions.push(modelInfo.contextWindow);
  }
  const def = defaultContextWindow(modelInfo);
  if (def > 0 && !ctxOptions.includes(def)) ctxOptions.push(def);
  ctxOptions.sort((a, b) => a - b);
  return ctxOptions;
}
