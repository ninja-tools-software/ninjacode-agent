/**
 * Derives a starting `verify.json` from what a workspace looks like.
 *
 * Completion verification is the strongest feedback loop in the harness and it
 * is inert without a `commands` list, which almost nobody writes by hand. This
 * module turns the shape of a repository into a plausible first list. It never
 * runs anything and never changes runtime behaviour: the result is a
 * suggestion, materialised only when the user explicitly asks to scaffold the
 * file.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { VerifyConfig } from "./verify.js";

/** Everything the inference looks at, so the decision stays a pure function. */
interface WorkspaceProbe {
  /** Entry names directly under the workspace root. */
  entries: string[];
  /** `scripts` from the root package.json, when it exists and parsed. */
  scripts?: Record<string, string>;
  /** Raw pyproject.toml contents, when present. */
  pyproject?: string;
}

/**
 * Verification runs on every completion that touched a file, so a slow list is
 * a list users switch off. Cheapest signal first, and never more than this
 * many commands.
 */
const MAX_COMMANDS = 3;

/** Script names to look for, in the order they should run. */
const SCRIPT_CANDIDATES: string[][] = [
  ["typecheck", "type-check", "tsc"],
  ["lint"],
  ["test", "test:unit"],
];

const LOCKFILE_MANAGERS: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

function packageManager(entries: string[]): string {
  for (const [lockfile, manager] of LOCKFILE_MANAGERS) {
    if (entries.includes(lockfile)) return manager;
  }
  return "npm";
}

function nodeCommands(probe: WorkspaceProbe): string[] {
  const scripts = probe.scripts;
  if (!scripts) return [];
  const manager = packageManager(probe.entries);
  const commands: string[] = [];
  for (const aliases of SCRIPT_CANDIDATES) {
    const found = aliases.find((name) => typeof scripts[name] === "string");
    if (found) commands.push(`${manager} run ${found}`);
  }
  return commands;
}

function pythonCommands(pyproject: string | undefined): string[] {
  if (!pyproject) return [];
  const commands: string[] = [];
  if (/\bruff\b/.test(pyproject)) commands.push("ruff check .");
  if (/\bmypy\b/.test(pyproject)) commands.push("mypy .");
  return commands;
}

/**
 * Verify commands for a workspace, cheapest first and capped. Returns an empty
 * list when nothing recognisable was found — the caller should say so rather
 * than invent a command.
 */
export function inferVerifyCommands(probe: WorkspaceProbe): string[] {
  const commands = [
    ...nodeCommands(probe),
    ...(probe.entries.includes("Cargo.toml") ? ["cargo check"] : []),
    ...(probe.entries.includes("go.mod") ? ["go build ./..."] : []),
    ...pythonCommands(probe.pyproject),
  ];
  return commands.slice(0, MAX_COMMANDS);
}

async function readJsonScripts(root: string): Promise<Record<string, string> | undefined> {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts;
  } catch {
    return undefined;
  }
}

/** Read the few workspace facts `inferVerifyCommands` needs. */
async function probeWorkspace(workspaceRoot: string): Promise<WorkspaceProbe> {
  const entries = await fs.readdir(workspaceRoot).catch(() => [] as string[]);
  const pyproject = entries.includes("pyproject.toml")
    ? await fs.readFile(path.join(workspaceRoot, "pyproject.toml"), "utf8").catch(() => undefined)
    : undefined;
  return { entries, scripts: await readJsonScripts(workspaceRoot), pyproject };
}

/** Render a commented `verify.json` — the comments are the documentation. */
function renderVerifyConfig(config: VerifyConfig): string {
  const commands = (config.commands ?? []).map((c) => `    ${JSON.stringify(c)}`).join(",\n");
  return `{
  // Commands run before the agent reports a task as done, in order.
  // Each must exit 0. They run on every completion that changed a file, so
  // keep them fast — move slow suites to CI.
  "commands": [
${commands}
  ],
  // Block completion while the files the agent touched still have errors.
  "requireCleanDiagnostics": ${config.requireCleanDiagnostics !== false}
}
`;
}

export type ScaffoldVerifyResult =
  | { status: "exists"; file: string }
  | { status: "created"; file: string; commands: string[] };

/**
 * Write a starting `verify.json` for this workspace. Existing configuration is
 * never overwritten, and `commands` comes back empty when the workspace shape
 * suggested nothing — the caller should tell the user to fill it in.
 */
export async function scaffoldVerifyConfig(
  workspaceRoot: string,
  agentDir: string,
): Promise<ScaffoldVerifyResult> {
  const file = path.join(agentDir, "verify.json");
  const existing = await fs.readFile(file, "utf8").catch(() => undefined);
  if (existing !== undefined) return { status: "exists", file };

  const commands = inferVerifyCommands(await probeWorkspace(workspaceRoot));
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(file, renderVerifyConfig({ commands, requireCleanDiagnostics: true }), "utf8");
  return { status: "created", file, commands };
}
