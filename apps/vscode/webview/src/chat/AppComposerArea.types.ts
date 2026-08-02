import type { RefObject } from "react";
import type { ComposerDoc } from "./composer/model.js";
import type { ComposerHandle } from "./composer/Composer.js";
import type { AutocompleteItem } from "./menus/AutocompleteMenu.js";
import type {
  ContextQueryType,
  ContextSuggestion,
  ContextUsage,
  Mode,
  ModelInfo,
  SettingsState,
  VoiceState,
  VsCodeApi,
} from "./types.js";

export interface AppComposerAreaProps {
  dragTipMounted: boolean;
  dragTipClosing: boolean;
  onDismissDragTip: () => void;
  contextUsage: ContextUsage | null;
  attachedTokens: number;
  onCompact: () => void;
  pickerMounted: boolean;
  pickerClosing: boolean;
  picker: {
    type: ContextQueryType;
    query: string;
    suggestions: ContextSuggestion[];
    setType: (t: ContextQueryType) => void;
    setQuery: (q: string) => void;
    pick: (item: ContextSuggestion) => void;
    addSelection: () => void;
    pickFiles: () => void;
    close: () => void;
  };
  menuMounted: boolean;
  menuClosing: boolean;
  menuItems: AutocompleteItem[];
  menuIndex: number;
  menuClassName: string;
  onMenuHover: (i: number) => void;
  onMenuPick: (index: number) => void;
  composerRef: RefObject<ComposerHandle | null>;
  doc: ComposerDoc;
  onDocChange: (doc: ComposerDoc, caret: number) => void;
  placeholder: string;
  onMenuKeyDown: (e: React.KeyboardEvent) => boolean;
  onToken: (token: import("./composer/token.js").ComposerToken | null) => void;
  onSubmit: () => void;
  onEscape: () => void;
  onDropItems: (items: import("./types.js").DropItem[], offset: number) => void;
  onDropSuggestion: (suggestion: import("./dnd/useDropTarget.js").DraggedSuggestion, offset: number) => void;
  onOpenRef: (ref: import("./types.js").ContextRef) => void;
  onPreviewRef: (ref: import("./types.js").ContextRef) => void;
  onFocusChange: (focused: boolean) => void;
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
  onStop: () => void;
  onStartVoice: () => void;
  onFinishVoice: () => void;
  vscode: VsCodeApi;
}
