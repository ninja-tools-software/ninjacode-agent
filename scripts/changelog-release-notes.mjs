import fs from "node:fs";

const version = process.argv[2];
const outFile = process.argv[3];
if (!version || !outFile) {
  console.error("usage: node scripts/changelog-release-notes.mjs <version> <outfile>");
  process.exit(1);
}

const heading = `## [${version}]`;
const changelog = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const start = changelog.indexOf(heading);
if (start === -1) {
  fs.writeFileSync(
    outFile,
    `NinjaCode Agent ${version}.\n\nSee CHANGELOG.md for details.\n`,
    "utf8",
  );
  process.exit(0);
}

let section = changelog.slice(start);
const nextHeading = section.indexOf("\n## [", heading.length);
if (nextHeading !== -1) section = section.slice(0, nextHeading);
const linkFoot = section.search(/\n\[[^\]]+\]:/);
if (linkFoot !== -1) section = section.slice(0, linkFoot);
fs.writeFileSync(outFile, `${section.trim()}\n`, "utf8");
