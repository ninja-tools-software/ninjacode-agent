import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` is injected by the extension host at runtime and has no npm
      // package; tests get a small stub instead.
      vscode: fileURLToPath(new URL("./test/vscode.stub.ts", import.meta.url)),
    },
  },
  test: {
    // The webview modules under test touch the DOM (composer caret mapping,
    // drag & drop parsing); the host modules don't care either way.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "webview/src/**/*.test.{ts,tsx}"],
  },
});
