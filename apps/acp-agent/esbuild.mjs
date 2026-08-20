import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(__dirname, "../..");

await esbuild.build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle: true,
  outfile: path.join(__dirname, "dist/ninjacode-acp.cjs"),
  alias: {
    "@ninjacode/core": path.join(workspace, "packages/core/src/index.ts"),
    "@ninjacode/providers": path.join(workspace, "packages/providers/src/index.ts"),
    "@ninjacode/tools": path.join(workspace, "packages/tools/src/index.ts"),
  },
  external: ["@vscode/ripgrep"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  logLevel: "info",
});
