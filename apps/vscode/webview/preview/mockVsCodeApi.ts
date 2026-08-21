/**
 * The `acquireVsCodeApi` the product bundle expects. Must be installed on
 * `window` before `src/main.tsx` runs, since that module calls it at import time.
 */
import type { WebviewToHost } from "../src/chat/types.js";

export interface MockVsCodeApi {
  postMessage: (msg: WebviewToHost) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

export type OutboundListener = (msg: WebviewToHost) => void;

const STATE_KEY = "ninjacode-preview-webview-state";

function readState(): unknown {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Creates the mock and returns it alongside the outbound message log, so the
 * preview toolbar and tests can inspect what the UI sent.
 */
export function createMockVsCodeApi(onMessage: OutboundListener): {
  api: MockVsCodeApi;
  sent: WebviewToHost[];
} {
  const sent: WebviewToHost[] = [];
  let state = readState();
  return {
    sent,
    api: {
      postMessage: (msg) => {
        sent.push(msg);
        onMessage(msg);
      },
      getState: () => state,
      setState: (next) => {
        state = next;
        try {
          localStorage.setItem(STATE_KEY, JSON.stringify(next));
        } catch {
          /* private browsing: the composer draft just does not survive reloads */
        }
      },
    },
  };
}

export function installMockVsCodeApi(api: MockVsCodeApi): void {
  (window as unknown as { acquireVsCodeApi: () => MockVsCodeApi }).acquireVsCodeApi = () => api;
}
