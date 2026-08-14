import { PlusIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { ModeMenu } from "../menus/ModeMenu.js";
import { ModelControls } from "../menus/ModelControls.js";
import { SendCluster } from "./SendCluster.js";
import type { Mode, ModelInfo, SendMode, SettingsState, VoiceState, VsCodeApi } from "../types.js";

interface ComposerToolbarProps {
  mode: Mode;
  setMode: (m: Mode) => void;
  settings: SettingsState | null;
  setSettings: (s: SettingsState) => void;
  modelInfo?: ModelInfo;
  busy: boolean;
  hasContent: boolean;
  pickerOpen: boolean;
  voiceState: VoiceState;
  voiceLevel: number;
  voiceSetup: string | null;
  showEnhance?: boolean;
  enhancing?: boolean;
  onEnhancePrompt?: () => void;
  onTogglePicker: () => void;
  onSubmit: (sendMode?: SendMode) => void;
  onStop: () => void;
  onStartVoice: () => void;
  onFinishVoice: () => void;
  vscode: VsCodeApi;
  openModelMenuNonce?: number;
}

export function ComposerToolbar(props: ComposerToolbarProps) {
  const { mode, setMode, settings, setSettings, modelInfo, pickerOpen, onTogglePicker, vscode } = props;
  return (
    <div className="composer-toolbar">
      <div className="composer-controls">
        <button
          className={`icon-btn icon-btn--sm ${pickerOpen ? "active" : ""}`}
          data-tooltip={t("Attach context")}
          aria-label={t("Attach context")}
          onClick={onTogglePicker}
        >
          <PlusIcon size={14} />
        </button>
        <ModeMenu mode={mode} setMode={setMode} />
        {settings && settings.models.length > 0 && (
          <ModelControls
            settings={settings}
            modelInfo={modelInfo}
            vscode={vscode}
            setSettings={setSettings}
            openModelMenuNonce={props.openModelMenuNonce}
          />
        )}
      </div>
      <SendCluster {...props} />
    </div>
  );
}
