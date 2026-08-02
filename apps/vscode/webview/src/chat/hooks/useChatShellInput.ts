import { useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { docToText } from "../composer/model.js";
import { nextMode } from "../modes.js";
import type { useComposerController } from "../state/useComposerController.js";
import type { Mode, SendMode, VsCodeApi } from "../types.js";

type Composer = ReturnType<typeof useComposerController>;

interface SubmitOptions {
  vscode: VsCodeApi;
  composer: Composer;
  stickToBottom: () => void;
  setHistoryOpen: (open: boolean) => void;
}

export function useChatShellSubmit(opts: SubmitOptions) {
  const stopAgent = useCallback(() => opts.vscode.postMessage({ type: "stop" }), [opts.vscode]);

  const submit = useCallback(
    (sendMode?: SendMode) => {
      const doc = opts.composer.doc;
      const text = docToText(doc);
      const refs = opts.composer.refs;
      if (!text && refs.length === 0) return;

      if (!sendMode && text === "/compact" && refs.length === 0) {
        opts.composer.clear();
        opts.vscode.postMessage({ type: "compact_conversation" });
        return;
      }

      opts.composer.clear();
      opts.setHistoryOpen(false);
      opts.stickToBottom();
      opts.vscode.postMessage({ type: "user_message", text, nodes: doc.nodes, refs, sendMode });
    },
    [opts],
  );

  return { stopAgent, submit };
}

export function useChatShellMenuKeys(composer: Composer) {
  return useCallback(
    (e: ReactKeyboardEvent): boolean => {
      if (composer.menuItems.length === 0) return false;
      const count = composer.menuItems.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        composer.setMenuIndex((composer.menuIndex + 1) % count);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        composer.setMenuIndex((composer.menuIndex - 1 + count) % count);
        return true;
      }
      if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        composer.acceptMenuItem();
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        composer.onToken(null);
        return true;
      }
      return false;
    },
    [composer],
  );
}

interface ShortcutOptions {
  vscode: VsCodeApi;
  mode: Mode;
  applyMode: (m: Mode) => void;
  busy: boolean;
  hasPlan: boolean;
}

export function useChatShellShortcuts(opts: ShortcutOptions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        opts.applyMode(nextMode(opts.mode));
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (e.defaultPrevented) return;
        if (!opts.hasPlan || opts.busy) return;
        e.preventDefault();
        opts.vscode.postMessage({ type: "execute_plan" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [opts]);
}
