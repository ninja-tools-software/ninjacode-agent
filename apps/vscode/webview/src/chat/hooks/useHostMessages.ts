/**
 * The single `window.message` listener.
 *
 * Conversation state goes straight to the reducer; everything else (settings,
 * composer insertions, voice) is forwarded to callbacks. The listener is
 * installed once and reads its handlers from a ref, so re-renders never
 * re-subscribe and no message is lost between them.
 */
import { useEffect, useRef } from "react";
import type { ChatAction } from "../state/chatReducer.js";
import type { HostToWebview, VsCodeApi } from "../types.js";
import { dispatchHostSideEffects, type HostHandlers } from "./hostMessageSideEffects.js";

export function useHostMessages(
  vscode: VsCodeApi,
  dispatch: (action: ChatAction) => void,
  handlers: HostHandlers,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const msg = event.data as HostToWebview | undefined;
      if (!msg || typeof msg.type !== "string") return;
      dispatch({ kind: "host", message: msg });
      dispatchHostSideEffects(msg, handlersRef.current);
    };

    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, [vscode, dispatch]);
}
