import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodePkg = JSON.parse(fs.readFileSync(path.join(root, "apps/vscode/package.json"), "utf8"));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const errors = [];
if (vscodePkg.scripts?.prebuild) {
  errors.push("apps/vscode/package.json must not define a prebuild hook");
}
if (vscodePkg.scripts?.build?.includes("bump-version") || vscodePkg.scripts?.build?.includes("version:bump")) {
  errors.push("apps/vscode build must not bump the version");
}
if (rootPkg.scripts?.build?.includes("version:bump")) {
  errors.push("root build must not bump the version");
}
if (rootPkg.version !== vscodePkg.version) {
  errors.push(`version mismatch: root=${rootPkg.version} vscode=${vscodePkg.version}`);
}
if (!vscodePkg.scripts?.["version:bump"]?.includes("bump-version.mjs")) {
  errors.push("version:bump must remain an explicit release command");
}

if (errors.length) {
  for (const error of errors) console.error(`verify-build-purity: ${error}`);
  process.exit(1);
}

console.log(`verify-build-purity: build is pure (version ${rootPkg.version})`);
