import fs from "node:fs/promises";
import path from "node:path";

/**
 * Workspace assets whose activation is tracked in `.ninjacode/config.json`.
 * MCP servers are excluded on purpose: their own config file owns an `enabled`
 * flag, so there is a single source of truth per family.
 */
export type AssetKind = "skill" | "agent" | "rule";

export interface WorkspaceAssetConfig {
  /** Skill names the user turned off. */
  disabledSkills: string[];
  /** Custom agent names the user turned off. */
  disabledAgents: string[];
  /** Rule files (workspace-relative paths) the user turned off. */
  disabledRules: string[];
}

const DISABLED_KEY: Record<AssetKind, keyof WorkspaceAssetConfig> = {
  skill: "disabledSkills",
  agent: "disabledAgents",
  rule: "disabledRules",
};

export function assetConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".ninjacode", "config.json");
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

/**
 * Read the activation config. A missing or malformed file means "nothing
 * disabled" — asset discovery must never fail because of it.
 */
export async function loadAssetConfig(workspaceRoot: string): Promise<WorkspaceAssetConfig> {
  const raw = await fs.readFile(assetConfigPath(workspaceRoot), "utf8").catch(() => null);
  if (raw === null) return { disabledSkills: [], disabledAgents: [], disabledRules: [] };
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { disabledSkills: [], disabledAgents: [], disabledRules: [] };
  }
  return {
    disabledSkills: normalizeList(parsed.disabledSkills),
    disabledAgents: normalizeList(parsed.disabledAgents),
    disabledRules: normalizeList(parsed.disabledRules),
  };
}

export function isAssetEnabled(
  config: WorkspaceAssetConfig,
  kind: AssetKind,
  id: string,
): boolean {
  return !config[DISABLED_KEY[kind]].includes(id);
}

/**
 * Toggle one asset. Unknown keys in the file are preserved so this stays
 * forward-compatible with other `.ninjacode/config.json` consumers.
 */
export async function setAssetEnabled(
  workspaceRoot: string,
  kind: AssetKind,
  id: string,
  enabled: boolean,
): Promise<void> {
  const file = assetConfigPath(workspaceRoot);
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  let existing: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const key = DISABLED_KEY[kind];
  const list = new Set(normalizeList(existing[key]));
  if (enabled) list.delete(id);
  else list.add(id);
  existing[key] = [...list].sort();

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}
