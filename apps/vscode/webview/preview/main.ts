/**
 * Entry point of the CSS playground: `pnpm --filter ninjacode dev:webview`.
 *
 * Mounts the real chat app against a mocked host so `src/styles/*.css` can be
 * edited with HMR instead of rebuilding and reloading the extension. The product
 * bundle is imported last and dynamically, because `src/main.tsx` calls
 * `acquireVsCodeApi()` and reads `document.body.dataset` at import time.
 */
import "./preview.css";
import { createMockHost, type UiLocale } from "./mockHost.js";
import { createMockVsCodeApi, installMockVsCodeApi } from "./mockVsCodeApi.js";
import { mountPreviewChrome, readPrefs } from "./previewChrome.js";
import { scenarioById } from "./scenarios/index.js";
import { applyPreviewTheme } from "./vscodeThemes.js";
import type { HostToWebview } from "../src/chat/types.js";

const prefs = readPrefs();
applyPreviewTheme(prefs.theme);
document.body.dataset.view = "chat";
document.body.dataset.locale = prefs.locale;

// `window.postMessage` is what a real webview receives, so the product's single
// `message` listener stays untouched.
const post = (msg: HostToWebview) => window.postMessage(msg, "*");
const host = createMockHost(post, scenarioById(prefs.scenario), prefs.locale);

const chrome = mountPreviewChrome(prefs, {
  onScenario: (id) => host.setScenario(scenarioById(id)),
  onLocale: (locale: UiLocale) => host.setLocale(locale),
  onReplay: () => host.replay(),
});

const { api } = createMockVsCodeApi((msg) => {
  host.handle(msg);
  chrome.showOutbound(msg.type);
});
installMockVsCodeApi(api);

await import("../src/main.js");
