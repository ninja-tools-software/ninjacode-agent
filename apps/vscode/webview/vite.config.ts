import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  // Dev server only serves `preview/` (the CSS playground); the VSIX ships the
  // `build` output below, which never includes it.
  server: { port: 5173, strictPort: false },
  build: {
    outDir: path.join(__dirname, "../dist/webview"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(__dirname, "index.html"),
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        // VS Code webviews load a single entry script; avoid lazy chunks that fail CSP fetch.
        inlineDynamicImports: true,
      },
    },
  },
  base: "./",
});
