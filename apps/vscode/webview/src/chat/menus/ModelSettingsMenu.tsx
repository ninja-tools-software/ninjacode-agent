import { useEffect, useState } from "react";
import { ChevronDownIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { animCls, useAnimatedPresence } from "../hooks/useAnimatedPresence.js";
import { useDismiss } from "../hooks/useDismiss.js";
import type { ModelInfo, SettingsState, VsCodeApi } from "../types.js";
import { modelSettingsSummaryParts } from "./modelMenuHelpers.js";
import { contextWindowOptions } from "./ModelMenuSections.js";
import { ModelMenuContextSection, ModelMenuReasoningSection } from "./modelMenuRows.js";

export function ModelSettingsMenu({
  settings,
  modelInfo,
  vscode,
  setSettings,
  open: controlledOpen,
  onOpenChange,
}: {
  settings: SettingsState;
  modelInfo?: ModelInfo;
  vscode: VsCodeApi;
  setSettings: (s: SettingsState) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  };
  useEffect(() => {
    if (controlledOpen === false) setInternalOpen(false);
  }, [controlledOpen]);

  const menuPresence = useAnimatedPresence(open);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const ctxOptions = contextWindowOptions(settings, modelInfo);
  const hasReasoning = Boolean(modelInfo?.reasoning);
  if (!hasReasoning && ctxOptions.length === 0) return null;

  const summary = modelSettingsSummaryParts(settings, modelInfo);

  return (
    <div className="model-menu-wrap model-settings-wrap" ref={rootRef}>
      {menuPresence.mounted && (
        <div
          className={animCls(
            "model-menu model-settings-menu anim-pop anim-pop-origin-bottom",
            menuPresence.closing && "anim-closing",
          )}
          role="dialog"
          aria-label={t("Thinking and context")}
        >
          {modelInfo && (
            <ModelMenuReasoningSection
              modelInfo={modelInfo}
              settings={settings}
              setSettings={setSettings}
              vscode={vscode}
            />
          )}
          <ModelMenuContextSection
            ctxOptions={ctxOptions}
            settings={settings}
            setSettings={setSettings}
            vscode={vscode}
            modelInfo={modelInfo}
          />
        </div>
      )}
      <button
        type="button"
        className="composer-pill model-settings-btn"
        data-tooltip={t("Thinking and context")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="model-settings-btn-label">
          {summary.effort && (
            <span className="model-settings-btn-effort">{t(summary.effort)}</span>
          )}
          <span className="model-settings-btn-context">{summary.context}</span>
        </span>
        <ChevronDownIcon size={12} />
      </button>
    </div>
  );
}
