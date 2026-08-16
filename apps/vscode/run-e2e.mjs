import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const executable = process.env.VSCODE_EXECUTABLE_PATH;

if (!executable) {
  throw new Error(
    "VSCODE_EXECUTABLE_PATH is required. The E2E runner never downloads VS Code; " +
      "point it at an existing VS Code or Electron executable.",
  );
}
await fs.access(executable);

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-vscode-e2e-"));
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-vscode-user-"));
const extensionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-vscode-ext-"));

try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        `--extensionDevelopmentPath=${root}`,
        `--extensionTestsPath=${path.join(root, "dist-e2e/extensionHost.cjs")}`,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        "--skip-welcome",
        "--skip-release-notes",
        workspace,
      ],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`VS Code extension-host tests exited with code ${code}`);
} finally {
  await Promise.all(
    [workspace, userDataDir, extensionsDir].map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
}
