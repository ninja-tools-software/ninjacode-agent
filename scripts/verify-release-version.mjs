import fs from "node:fs";

const root = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const extension = JSON.parse(
  fs.readFileSync(new URL("../apps/vscode/package.json", import.meta.url), "utf8"),
);

if (root.version !== extension.version) {
  console.error(`Release versions differ: root=${root.version}, vscode=${extension.version}`);
  process.exit(1);
}

const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== `v${root.version}`) {
  console.error(`Release tag ${tag} does not match package version v${root.version}`);
  process.exit(1);
}

console.log(`Release version verified: ${root.version}`);
