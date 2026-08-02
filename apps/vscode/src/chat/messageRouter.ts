import type { ChatToHost, SettingsToHost, WebviewToHost } from "../protocol.js";

/**
 * One handler per chat message type. Being a mapped type over the whole union, a
 * new message in `ChatToHost` is a compile error here until it is handled — which
 * is the entire point of replacing the old 265-line `switch`.
 */
export type ChatMessageHandlers = {
  [K in ChatToHost["type"]]: (msg: Extract<ChatToHost, { type: K }>) => void | PromiseLike<unknown>;
};

type AnyChatHandler = (msg: ChatToHost) => void | PromiseLike<unknown>;

/**
 * Build the webview message dispatcher. Anything not in `handlers` is a settings
 * mutation and goes to `handleSettings`, which is shared with the Settings tab.
 */
export function createMessageRouter(
  handlers: ChatMessageHandlers,
  handleSettings: (msg: SettingsToHost) => Promise<boolean>,
): (msg: WebviewToHost) => Promise<void> {
  const table = handlers as Record<string, AnyChatHandler | undefined>;
  return async (msg: WebviewToHost) => {
    const handler = table[msg.type];
    if (handler) {
      await handler(msg as ChatToHost);
      return;
    }
    await handleSettings(msg as SettingsToHost);
  };
}
