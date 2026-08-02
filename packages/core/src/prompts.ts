import os from "node:os";
import path from "node:path";
import { parseFrontmatter, toOptionalString } from "./frontmatter.js";
import { listFilesWithSuffix, readFileSafe } from "./fsScan.js";

export type PromptScope = "project" | "user";

/** A reusable prompt / custom slash command loaded from a `.prompt.md` (or similar) file. */
export interface PromptDefinition {
  /** Slash command name, derived from the filename (e.g. `review.prompt.md` -> `review`). */
  name: string;
  description?: string;
  /** Short hint shown in autocomplete for what argument text the command expects. */
  argumentHint?: string;
  model?: string;
  /** Prompt body (frontmatter stripped). May contain a `$ARGUMENTS` placeholder. */
  body: string;
  /** Absolute path this prompt was loaded from. */
  path: string;
  scope: PromptScope;
}

interface PromptDirSpec {
  dir: string;
  suffixes: string[];
  scope: PromptScope;
}

function projectPromptDirs(workspaceRoot: string): PromptDirSpec[] {
  return [
    { dir: path.join(workspaceRoot, ".github", "prompts"), suffixes: [".prompt.md"], scope: "project" },
    { dir: path.join(workspaceRoot, ".claude", "commands"), suffixes: [".md"], scope: "project" },
    { dir: path.join(workspaceRoot, ".ninjacode", "prompts"), suffixes: [".md"], scope: "project" },
  ];
}

function userPromptDirs(): PromptDirSpec[] {
  const home = os.homedir();
  return [
    { dir: path.join(home, ".claude", "commands"), suffixes: [".md"], scope: "user" },
    { dir: path.join(home, ".ninjacode", "prompts"), suffixes: [".md"], scope: "user" },
  ];
}

function nameFromFile(filePath: string, suffixes: string[]): string {
  const base = path.basename(filePath);
  for (const suf of suffixes) {
    if (base.endsWith(suf)) return base.slice(0, -suf.length);
  }
  return base.replace(/\.md$/, "");
}

async function loadFromSpec(spec: PromptDirSpec): Promise<PromptDefinition[]> {
  const files = await listFilesWithSuffix(spec.dir, spec.suffixes);
  const out: PromptDefinition[] = [];
  for (const file of files) {
    const raw = await readFileSafe(file);
    if (raw === null || !raw.trim()) continue;
    const { data, body } = parseFrontmatter(raw);
    if (!body.trim()) continue;
    out.push({
      name: nameFromFile(file, spec.suffixes),
      description: toOptionalString(data.description),
      argumentHint: toOptionalString(data["argument-hint"] ?? data.argumentHint),
      model: toOptionalString(data.model),
      body: body.trim(),
      path: file,
      scope: spec.scope,
    });
  }
  return out;
}

/**
 * Load custom prompt/slash-command definitions from project locations
 * (`.github/prompts/*.prompt.md`, `.claude/commands/*.md`, `.ninjacode/prompts/*.md`)
 * and user locations (`~/.claude/commands/*.md`, `~/.ninjacode/prompts/*.md`).
 * Project prompts take precedence over user prompts with the same name.
 */
export async function loadPrompts(workspaceRoot: string): Promise<PromptDefinition[]> {
  const [projectLists, userLists] = await Promise.all([
    Promise.all(projectPromptDirs(workspaceRoot).map(loadFromSpec)),
    Promise.all(userPromptDirs().map(loadFromSpec)),
  ]);

  const byName = new Map<string, PromptDefinition>();
  for (const p of userLists.flat()) byName.set(p.name, p);
  for (const p of projectLists.flat()) byName.set(p.name, p); // project overrides user
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Substitute a `$ARGUMENTS` placeholder in a prompt body with user-supplied
 * argument text; if no placeholder is present, the arguments are appended.
 */
export function expandPromptArguments(body: string, args: string): string {
  if (!args.trim()) return body;
  if (body.includes("$ARGUMENTS")) return body.replaceAll("$ARGUMENTS", args);
  return `${body}\n\n${args}`;
}
