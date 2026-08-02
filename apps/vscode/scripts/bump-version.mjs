import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version ?? "");
if (!match) {
  console.error(`bump-version: invalid semver in package.json: ${JSON.stringify(pkg.version)}`);
  process.exit(1);
}

const [, major, minor, patch] = match;
const previous = pkg.version;
const next = `${major}.${minor}.${Number(patch) + 1}`;

pkg.version = next;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(`Bumped ninjacode extension: ${previous} → ${next}`);
