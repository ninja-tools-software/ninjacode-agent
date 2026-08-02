import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: [path.join(__dirname, "src/extension.ts")],
  bundle: true,
  outfile: path.join(__dirname, "dist/extension.js"),
  external: ["vscode", "@vscode/ripgrep"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("watching extension…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
