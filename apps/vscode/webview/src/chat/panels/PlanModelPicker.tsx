import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BrainIcon, CheckIcon, ChevronDownIcon } from "../../icons.js";
import { formatContext } from "../format.js";
import { animCls, useAnimatedPresence } from "../hooks/useAnimatedPresence.js";
import type { SettingsState, VsCodeApi } from "../types.js";
import { ModelCostBadge } from "../menus/modelMenuMetrics.js";
import { t } from "../../i18n.js";

const MENU_WIDTH = 360;
const MENU_MAX_HEIGHT = 320;
const MENU_GAP = 6;

function menuPosition(anchor: DOMRect): {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
  openUp: boolean;
} {
  const spaceBelow = window.innerHeight - anchor.bottom - MENU_GAP;
  const spaceAbove = anchor.top - MENU_GAP;
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(MENU_MAX_HEIGHT, (openUp ? spaceAbove : spaceBelow) - 8);
  const left = Math.max(8, Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));

  if (openUp) {
    return { bottom: window.innerHeight - anchor.top + MENU_GAP, left, maxHeight, openUp: true as const };
  }
  return { top: anchor.bottom + MENU_GAP, left, maxHeight, openUp: false as const };
}

function useAnchoredModelMenu(menuOpen: boolean) {
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reposition = () => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const pos = menuPosition(anchor);
    setMenuStyle({
      position: "fixed",
      left: pos.left,
      width: MENU_WIDTH,
      maxHeight: Math.max(120, pos.maxHeight),
      ...(pos.openUp ? { bottom: pos.bottom, top: "auto" } : { top: pos.top, bottom: "auto" }),
    });
  };

  useLayoutEffect(() => {
    if (!menuOpen) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [menuOpen]);

  return { buttonRef, menuRef, menuStyle, reposition };
}

function useDismissModelMenu(
  menuOpen: boolean,
  setMenuOpen: (open: boolean) => void,
  buttonRef: React.RefObject<HTMLButtonElement | null>,
  menuRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, setMenuOpen, buttonRef, menuRef]);
}

function PlanModelMenuItem({
  model,
  selected,
  showMetrics,
  onSelect,
}: {
  model: NonNullable<SettingsState["models"]>[number];
  selected: boolean;
  showMetrics: boolean;
  onSelect: (modelId: string) => void;
}) {
  const hasCost = showMetrics && typeof model.costIndex === "number";
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`model-menu-item${selected ? " selected" : ""}${hasCost ? " has-cost" : ""}`}
      onClick={() => onSelect(model.id)}
    >
      <span className="model-menu-check">{selected && <CheckIcon size={12} />}</span>
      <span className="model-menu-main">
        <span className="model-menu-label" data-tooltip={model.label}>
          {model.label}
        </span>
        {model.reasoning ? (
          <span className="model-menu-cap" aria-label={t("Reasoning")} data-tooltip={t("Reasoning")}>
            <BrainIcon size={12} />
          </span>
        ) : null}
      </span>
      {hasCost ? <ModelCostBadge costIndex={model.costIndex as number} /> : null}
      <span className="model-menu-meta">{formatContext(model.contextWindow)} ctx</span>
    </button>
  );
}

function PlanModelMenuList({
  models,
  selectedModel,
  showMetrics,
  menuRef,
  menuStyle,
  menuClassName,
  closing,
  onSelect,
}: {
  models: NonNullable<SettingsState["models"]>;
  selectedModel: string | undefined;
  showMetrics: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  menuStyle: React.CSSProperties;
  menuClassName: string;
  closing?: boolean;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div
      ref={menuRef}
      className={animCls(
        `model-menu ${menuClassName} plan-model-menu-portal anim-pop`,
        closing && "anim-closing",
        menuStyle.bottom !== undefined && menuStyle.bottom !== "auto"
          ? "anim-pop-origin-bottom"
          : "anim-pop-origin-top",
      )}
      style={menuStyle}
      role="listbox"
      aria-label={t("Execute with model")}
    >
      <div className="model-menu-section">
        {models.map((m) => (
          <PlanModelMenuItem
            key={m.id}
            model={m}
            selected={m.id === selectedModel}
            showMetrics={showMetrics}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function PlanModelPickerTrigger({
  buttonRef,
  busy,
  menuOpen,
  label,
  onToggle,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  busy: boolean;
  menuOpen: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="plan-model-pick"
      disabled={busy}
      aria-expanded={menuOpen}
      aria-haspopup="listbox"
      data-tooltip={t("Choose model for plan execution")}
      onClick={onToggle}
    >
      <span className="plan-model-pick-label">{label}</span>
      <ChevronDownIcon size={12} />
    </button>
  );
}

function planModelLabel(
  models: NonNullable<SettingsState["models"]>,
  selectedModel: string | undefined,
  defaultModel: string | undefined,
): string {
  return (
    models.find((m) => m.id === selectedModel)?.label ??
    models.find((m) => m.id === defaultModel)?.label ??
    "Default model"
  );
}

function usePlanModelPickerState(defaultModel: string | undefined) {
  const [selectedModel, setSelectedModel] = useState<string | undefined>(defaultModel);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPresence = useAnimatedPresence(menuOpen);
  const anchor = useAnchoredModelMenu(menuOpen);

  useEffect(() => {
    setSelectedModel(defaultModel);
  }, [defaultModel]);

  useDismissModelMenu(menuOpen, setMenuOpen, anchor.buttonRef, anchor.menuRef);

  return { selectedModel, setSelectedModel, menuOpen, setMenuOpen, menuPresence, ...anchor };
}

export function PlanModelPicker({
  busy,
  settings,
  vscode,
  onModelChange,
  menuClassName = "plan-model-menu",
}: {
  busy: boolean;
  settings: SettingsState | null;
  vscode: VsCodeApi;
  onModelChange?: (model: string) => void;
  menuClassName?: string;
}) {
  const models = settings?.models ?? [];
  const defaultModel = settings?.model;
  const showMetrics = settings?.provider === "gateway";
  const picker = usePlanModelPickerState(defaultModel);
  const selectedLabel = planModelLabel(models, picker.selectedModel, defaultModel);

  if (models.length === 0) return null;

  const selectModel = (modelId: string) => {
    picker.setSelectedModel(modelId);
    picker.setMenuOpen(false);
    if (onModelChange) onModelChange(modelId);
    else vscode.postMessage({ type: "set_model", model: modelId });
  };

  const menu =
    picker.menuPresence.mounted &&
    createPortal(
      <PlanModelMenuList
        models={models}
        selectedModel={picker.selectedModel}
        showMetrics={showMetrics}
        menuRef={picker.menuRef}
        menuStyle={picker.menuStyle}
        menuClassName={menuClassName}
        closing={picker.menuPresence.closing}
        onSelect={selectModel}
      />,
      document.body,
    );

  return (
    <div className="plan-model-picker">
      <PlanModelPickerTrigger
        buttonRef={picker.buttonRef}
        busy={busy}
        menuOpen={picker.menuOpen}
        label={selectedLabel}
        onToggle={() => {
          picker.setMenuOpen((v) => {
            const next = !v;
            if (next) requestAnimationFrame(picker.reposition);
            return next;
          });
        }}
      />
      {menu}
    </div>
  );
}
