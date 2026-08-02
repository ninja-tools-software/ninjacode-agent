import { CheckIcon, LoaderIcon, MicIcon, StopIcon, WandIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { VoiceSpectrum } from "../ui/VoiceSpectrum.js";
import type { SendMode, VoiceState } from "../types.js";

interface SendClusterProps {
  busy: boolean;
  hasContent: boolean;
  voiceState: VoiceState;
  voiceLevel: number;
  voiceSetup: string | null;
  showEnhance?: boolean;
  enhancing?: boolean;
  onEnhancePrompt?: () => void;
  onSubmit: (sendMode?: SendMode) => void;
  onStop: () => void;
  onStartVoice: () => void;
  onFinishVoice: () => void;
}

/** Which action the primary button offers right now. */
function primaryState(
  busy: boolean,
  voiceState: VoiceState,
  hasContent: boolean,
): "stop" | "rec" | "trans" | "send" | "mic" {
  if (busy) return "stop";
  if (voiceState === "recording") return "rec";
  if (voiceState === "transcribing") return "trans";
  return hasContent ? "send" : "mic";
}

function BusySendCluster({ hasContent, onSubmit, onStop }: SendClusterProps) {
  if (hasContent) {
    return (
      <div className="send-modes">
        <button
          className="btn"
          data-tooltip={t(
            "Queue this message — it will send after the current run finishes",
          )}
          onClick={() => onSubmit("queue")}
        >
          {t("Queue")}
        </button>
        <button
          className="btn"
          data-tooltip={t("Interrupt the current run and restart with this message")}
          onClick={() => onSubmit("steer")}
        >
          {t("Steer")}
        </button>
        <button
          className="btn danger"
          data-tooltip={t("Stop the current run now and send this message")}
          onClick={() => onSubmit("stop_and_send")}
        >
          {t("Stop & Send")}
        </button>
      </div>
    );
  }
  return (
    <button
      id="send"
      className="send-btn stop send-btn-state"
      data-tooltip={t("Stop agent (Esc)")}
      aria-label={t("Stop agent")}
      onClick={onStop}
    >
      <StopIcon />
    </button>
  );
}

function RecordingSendCluster({ voiceLevel, onFinishVoice }: SendClusterProps) {
  return (
    <div className="composer-send-cluster">
      <VoiceSpectrum level={voiceLevel} />
      <button
        className="send-btn stop send-btn-state"
        data-tooltip={t("Stop dictation (Esc to cancel)")}
        aria-label={t("Stop dictation")}
        onClick={onFinishVoice}
      >
        <StopIcon />
      </button>
      <button className="send-btn" disabled data-tooltip={t("Listening…")} aria-label={t("Validate")}>
        <CheckIcon size={18} />
      </button>
    </div>
  );
}

function TranscribingSendButton({ voiceSetup }: SendClusterProps) {
  return (
    <button
      className="send-btn send-btn-state"
      disabled
      data-tooltip={voiceSetup ?? t("Transcribing…")}
      aria-label={t("Validate")}
    >
      <CheckIcon size={18} />
    </button>
  );
}

function EnhanceButton({
  enhancing,
  onEnhancePrompt,
}: {
  enhancing: boolean;
  onEnhancePrompt?: () => void;
}) {
  return (
    <button
      type="button"
      className="send-btn enhance send-btn-state"
      disabled={enhancing}
      data-tooltip={enhancing ? t("Enhancing prompt…") : t("Enhance prompt")}
      aria-label={enhancing ? t("Enhancing prompt…") : t("Enhance prompt")}
      onClick={onEnhancePrompt}
    >
      {enhancing ? <LoaderIcon size={14} className="todo-spin" /> : <WandIcon size={14} />}
    </button>
  );
}

function IdleSendCluster({
  hasContent,
  voiceSetup,
  showEnhance,
  enhancing,
  onEnhancePrompt,
  onSubmit,
  onStartVoice,
}: SendClusterProps) {
  if (hasContent) {
    return (
      <div className="composer-send-cluster">
        {showEnhance ? (
          <EnhanceButton enhancing={Boolean(enhancing)} onEnhancePrompt={onEnhancePrompt} />
        ) : null}
        <button
          id="send"
          className="send-btn send-btn-state"
          data-tooltip={t("Send")}
          aria-label={t("Send")}
          onClick={() => onSubmit()}
        >
          <CheckIcon size={18} />
        </button>
      </div>
    );
  }
  return (
    <button
      id="send"
      className="send-btn mic send-btn-state"
      data-tooltip={voiceSetup ?? t("Dictate (voice input)")}
      aria-label={t("Dictate")}
      onClick={onStartVoice}
    >
      <MicIcon />
    </button>
  );
}

export function SendCluster(props: SendClusterProps) {
  const { busy, voiceState } = props;
  const state = primaryState(busy, voiceState, props.hasContent);

  if (busy) return <BusySendCluster key={state} {...props} />;
  if (voiceState === "recording") return <RecordingSendCluster key={state} {...props} />;
  if (voiceState === "transcribing") return <TranscribingSendButton key={state} {...props} />;
  return <IdleSendCluster key={state} {...props} />;
}
