import type { HostToWebview } from "../types.js";

type MessageOf<T extends HostToWebview["type"]> = Extract<HostToWebview, { type: T }>;

export interface HostHandlers {
  onSettings: (msg: MessageOf<"settings">) => void;
  onLocale: (msg: MessageOf<"set_locale">) => void;
  onMode: (msg: MessageOf<"mode">) => void;
  onCompose: (msg: MessageOf<"compose">) => void;
  onMentionSuggestions: (msg: MessageOf<"mention_suggestions">) => void;
  onContextSuggestions: (msg: MessageOf<"context_suggestions">) => void;
  onContextResolved: (msg: MessageOf<"context_resolved">) => void;
  onRefsResolved: (msg: MessageOf<"refs_resolved">) => void;
  onContextInsert: (msg: MessageOf<"context_insert">) => void;
  onRefPreview: (msg: MessageOf<"ref_preview_result">) => void;
  onSlashCommands: (msg: MessageOf<"slash_commands">) => void;
  onVoice: (
    msg: Extract<HostToWebview, { type: `voice_${string}` }>,
  ) => void;
  onEnhancePromptResult: (msg: MessageOf<"enhance_prompt_result">) => void;
  onEnhancePromptError: (msg: MessageOf<"enhance_prompt_error">) => void;
  onOpenModelMenu: () => void;
  onClear: () => void;
  onHydrate: () => void;
}

type SideEffectHandler = (msg: HostToWebview, h: HostHandlers) => void;

const sideEffectByType: Partial<Record<HostToWebview["type"], SideEffectHandler>> = {
  hydrate: (_msg, h) => h.onHydrate(),
  clear: (_msg, h) => h.onClear(),
  settings: (msg, h) => h.onSettings(msg as MessageOf<"settings">),
  set_locale: (msg, h) => h.onLocale(msg as MessageOf<"set_locale">),
  mode: (msg, h) => h.onMode(msg as MessageOf<"mode">),
  compose: (msg, h) => h.onCompose(msg as MessageOf<"compose">),
  mention_suggestions: (msg, h) => h.onMentionSuggestions(msg as MessageOf<"mention_suggestions">),
  context_suggestions: (msg, h) => h.onContextSuggestions(msg as MessageOf<"context_suggestions">),
  context_resolved: (msg, h) => h.onContextResolved(msg as MessageOf<"context_resolved">),
  refs_resolved: (msg, h) => h.onRefsResolved(msg as MessageOf<"refs_resolved">),
  context_insert: (msg, h) => h.onContextInsert(msg as MessageOf<"context_insert">),
  ref_preview_result: (msg, h) => h.onRefPreview(msg as MessageOf<"ref_preview_result">),
  slash_commands: (msg, h) => h.onSlashCommands(msg as MessageOf<"slash_commands">),
  voice_partial: (msg, h) => h.onVoice(msg as Extract<HostToWebview, { type: `voice_${string}` }>),
  voice_final: (msg, h) => h.onVoice(msg as Extract<HostToWebview, { type: `voice_${string}` }>),
  voice_level: (msg, h) => h.onVoice(msg as Extract<HostToWebview, { type: `voice_${string}` }>),
  voice_error: (msg, h) => h.onVoice(msg as Extract<HostToWebview, { type: `voice_${string}` }>),
  voice_setup_progress: (msg, h) => h.onVoice(msg as Extract<HostToWebview, { type: `voice_${string}` }>),
  enhance_prompt_result: (msg, h) =>
    h.onEnhancePromptResult(msg as MessageOf<"enhance_prompt_result">),
  enhance_prompt_error: (msg, h) =>
    h.onEnhancePromptError(msg as MessageOf<"enhance_prompt_error">),
  open_model_menu: (_msg, h) => h.onOpenModelMenu(),
};

/** Side effects outside the reducer for a host → webview message. */
export function dispatchHostSideEffects(msg: HostToWebview, h: HostHandlers): void {
  sideEffectByType[msg.type]?.(msg, h);
}
