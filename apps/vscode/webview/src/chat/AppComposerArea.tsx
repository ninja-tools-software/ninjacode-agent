import { t } from "../i18n.js";
import { docLength, isEmpty, type ComposerDoc } from "./composer/model.js";
import { Composer } from "./composer/Composer.js";
import { ComposerToolbar } from "./composer/ComposerToolbar.js";
import { ComposerOverlays } from "./ComposerOverlays.js";
import type { AppComposerAreaProps } from "./AppComposerArea.types.js";

export type { AppComposerAreaProps } from "./AppComposerArea.types.js";

export function AppComposerArea(props: AppComposerAreaProps) {
  return (
    <footer>
      <ComposerOverlays {...props} />
      <Composer
        ref={props.composerRef}
        doc={props.doc}
        onChange={props.onDocChange}
        placeholder={props.placeholder}
        mode={props.mode}
        onMenuKeyDown={props.onMenuKeyDown}
        onToken={props.onToken}
        onSubmit={props.onSubmit}
        onEscape={props.onEscape}
        onDropItems={props.onDropItems}
        onDropSuggestion={props.onDropSuggestion}
        onOpenRef={props.onOpenRef}
        onPreviewRef={props.onPreviewRef}
        onFocusChange={props.onFocusChange}
      >
        <ComposerToolbar
          mode={props.mode}
          setMode={props.setMode}
          settings={props.settings}
          setSettings={props.setSettings}
          modelInfo={props.modelInfo}
          busy={props.busy}
          hasContent={props.hasContent}
          pickerOpen={props.pickerOpen}
          voiceState={props.voiceState}
          voiceLevel={props.voiceLevel}
          voiceSetup={props.voiceSetup}
          showEnhance={props.showEnhance}
          enhancing={props.enhancing}
          onEnhancePrompt={props.onEnhancePrompt}
          onTogglePicker={props.onTogglePicker}
          onSubmit={props.onSubmit}
          onStop={props.onStop}
          onStartVoice={props.onStartVoice}
          onFinishVoice={props.onFinishVoice}
          vscode={props.vscode}
        />
      </Composer>
    </footer>
  );
}

export function appHasComposerContent(doc: ComposerDoc): boolean {
  return !isEmpty(doc);
}

export function voicePlaceholder(mode: import("./types.js").Mode, voiceState: string): string {
  if (voiceState === "recording") return t("Listening… (Esc to cancel)");
  if (voiceState === "transcribing") return t("Transcribing…");
  if (mode === "debug") return t("Describe the bug, expected vs actual, and repro steps…");
  return t("Describe a coding task… Use @file, + or drag files in");
}

export { docLength };
