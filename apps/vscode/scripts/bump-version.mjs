import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(scriptDir, "..", "package.json");
const rootPath = path.join(scriptDir, "..", "..", "..", "package.json");

if (process.env.NINJACODE_BUMP === "skip") {
  console.log("bump-version: skipped (NINJACODE_BUMP=skip)");
  process.exit(0);
}

const extension = JSON.parse(fs.readFileSync(extensionPath, "utf8"));

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(extension.version ?? "");
if (!match) {
  console.error(`bump-version: invalid semver in package.json: ${JSON.stringify(extension.version)}`);
  process.exit(1);
}

const [, major, minor, patch] = match;
const previous = extension.version;
const next = `${major}.${minor}.${Number(patch) + 1}`;

function writeVersion(filePath, version) {
  const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

writeVersion(extensionPath, next);
writeVersion(rootPath, next);
console.log(`Bumped ninjacode extension: ${previous} → ${next}`);
