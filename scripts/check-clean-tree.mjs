import { spawnSync } from "node:child_process";

const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (probe.status !== 0 || probe.stdout.trim() !== "true") {
  console.warn("check-clean-tree: skipped because Git metadata is unavailable");
  process.exit(0);
}

const status = spawnSync("git", ["status", "--porcelain", "--", "."], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (status.status !== 0) {
  process.stderr.write(status.stderr);
  console.error("check-clean-tree: failed to read Git status");
  process.exit(1);
}

if (status.stdout.trim()) {
  process.stderr.write(status.stdout);
  console.error("check-clean-tree: build or tests left a dirty Git tree");
  process.exit(1);
}

console.log("check-clean-tree: working tree is strictly clean");
