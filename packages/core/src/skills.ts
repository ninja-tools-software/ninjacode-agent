import fs from "node:fs/promises";
import path from "node:path";
import type { LlmProvider } from "@ninjacode/providers";
import {
  resolveInWorkspace,
  toWorkspaceRelative,
  ToolError,
  type Tool,
  type ToolContext,
} from "@ninjacode/tools";
import { isAssetEnabled, loadAssetConfig } from "./assetRegistry.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  toOptionalString,
  toStringArray,
} from "./frontmatter.js";
import { listSubdirs, readFileSafe } from "./fsScan.js";
import { toSlug } from "./slug.js";
import type { AgentFactory } from "./agentFactory.js";
import { runSubAgent } from "./subagents.js";
import type { AgentEventHandler } from "./types.js";

export type SkillContext = "inline" | "fork";

/**
 * A SKILL.md-based capability, loaded progressively: `discoverSkills` only reads
 * name/description (cheap, kept in the system prompt at all times), and the
 * full instructions body is fetched on demand via `loadSkillBody` — mirroring
 * the progressive-disclosure pattern used by Cursor/Claude skills.
 */
export interface SkillDefinition {
  name: string;
  description: string;
  /** "fork" runs the skill in an isolated sub-agent instead of inlining its body into the caller. */
  context: SkillContext;
  allowedTools?: string[];
  /** Directory containing SKILL.md (for resolving skill-relative resources). */
  dir: string;
  /** Absolute path to SKILL.md itself. */
  skillFile: string;
  /** Workspace-relative base directory this skill came from (e.g. `.ninjacode/skills`). */
  source: string;
  /** False when disabled in `.ninjacode/config.json`: still listed, never registered. */
  enabled: boolean;
}

/** Last entry wins on name collisions, so `.ninjacode/skills` overrides the others. */
const SKILL_BASE_DIRS = [
  ".github/skills",
  ".agents/skills",
  ".claude/skills",
  ".ninjacode/skills",
];

/** Where skills created from the UI are written. */
export const SKILLS_WRITE_DIR = ".ninjacode/skills";

async function discoverInBase(workspaceRoot: string, rel: string): Promise<SkillDefinition[]> {
  const skillDirs = await listSubdirs(path.join(workspaceRoot, rel));
  const out: SkillDefinition[] = [];
  for (const dir of skillDirs) {
    const skillFile = path.join(dir, "SKILL.md");
    const raw = await readFileSafe(skillFile);
    if (raw === null || !raw.trim()) continue;
    const { data } = parseFrontmatter(raw);
    const name = toOptionalString(data.name) ?? path.basename(dir);
    const description = toOptionalString(data.description) ?? "";
    const context = data.context === "fork" ? "fork" : "inline";
    const allowedTools = toStringArray(data["allowed-tools"] ?? data.allowedTools);
    out.push({
      name,
      description,
      context,
      allowedTools: allowedTools.length ? allowedTools : undefined,
      dir,
      skillFile,
      source: rel,
      enabled: true,
    });
  }
  return out;
}

/**
 * Progressive-loading level 1: discover every SKILL.md under
 * `.github/skills`, `.agents/skills`, `.claude/skills` and `.ninjacode/skills`,
 * returning only their metadata (name/description/context) — cheap enough to
 * always include in the system prompt so the model knows what's available
 * without paying full body cost.
 *
 * Skills disabled in `.ninjacode/config.json` are returned with
 * `enabled: false` rather than dropped, so the settings UI can list them; use
 * `enabledSkills` for anything that feeds the agent.
 */
export async function discoverSkills(workspaceRoot: string): Promise<SkillDefinition[]> {
  const [lists, config] = await Promise.all([
    Promise.all(SKILL_BASE_DIRS.map((rel) => discoverInBase(workspaceRoot, rel))),
    loadAssetConfig(workspaceRoot),
  ]);
  const byName = new Map<string, SkillDefinition>();
  for (const list of lists) {
    for (const s of list) {
      byName.set(s.name, { ...s, enabled: isAssetEnabled(config, "skill", s.name) });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The subset of discovered skills the agent may actually use. */
export function enabledSkills(skills: SkillDefinition[]): SkillDefinition[] {
  return skills.filter((s) => s.enabled);
}

export interface SkillInput {
  name: string;
  description: string;
  context: SkillContext;
  allowedTools?: string[];
  body: string;
  /** Existing SKILL.md to overwrite (rename/move stays out of scope). */
  skillFile?: string;
}

/** Directory name derived from a skill name: safe on every filesystem. */
/**
 * Create or update a SKILL.md. New skills land in `.ninjacode/skills/<slug>/`;
 * editing an existing one writes back to its own file, wherever it came from.
 * Returns the workspace-relative path written.
 */
export async function writeSkill(workspaceRoot: string, input: SkillInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new ToolError("Skill name is required", "invalid_args");
  const target = input.skillFile
    ? resolveInWorkspace(workspaceRoot, input.skillFile)
    : resolveInWorkspace(
        workspaceRoot,
        path.join(SKILLS_WRITE_DIR, toSlug(name, "skill"), "SKILL.md"),
      );

  const content = stringifyFrontmatter(
    {
      name,
      description: input.description,
      context: input.context,
      "allowed-tools": input.allowedTools,
    },
    input.body,
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return toWorkspaceRelative(workspaceRoot, target);
}

/**
 * Delete a skill. The whole skill directory goes when it only holds SKILL.md,
 * otherwise just the manifest — a skill folder can carry scripts and assets the
 * user may still want.
 */
export async function deleteSkill(workspaceRoot: string, skillFile: string): Promise<void> {
  const target = resolveInWorkspace(workspaceRoot, skillFile);
  const dir = path.dirname(target);
  await fs.rm(target, { force: true });
  const remaining = await fs.readdir(dir).catch(() => ["keep"]);
  if (remaining.length === 0) await fs.rm(dir, { recursive: true, force: true });
}

/** Progressive-loading level 2: read the full SKILL.md body (frontmatter stripped) on demand. */
export async function loadSkillBody(skill: SkillDefinition): Promise<string> {
  const raw = await readFileSafe(skill.skillFile);
  if (raw === null) return "";
  return parseFrontmatter(raw).body.trim();
}

/**
 * Build the `use_skill` tool: given a skill name, either returns its full
 * instructions (inline — the caller follows them itself) or, for skills
 * declaring `context: fork`, delegates execution to an isolated sub-agent via
 * the existing `runSubAgent` infra so the skill's work doesn't consume the
 * primary agent's context window.
 */
async function executeUseSkill(
  skills: SkillDefinition[],
  deps: {
    createAgent: AgentFactory;
    provider: LlmProvider;
    workspaceRoot: string;
    agentDir: string;
    onEvent?: AgentEventHandler;
  },
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<{ output: string; meta: Record<string, unknown> }> {
  const name = String(args.skill ?? "").trim();
  const skill = skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!skill) {
    return {
      output: `Unknown skill "${name}". Available: ${skills.map((s) => s.name).join(", ") || "(none)"}`,
      meta: { found: false },
    };
  }

  const body = await loadSkillBody(skill);
  if (skill.context !== "fork") {
    return {
      output: `# Skill: ${skill.name}\n${body || skill.description}`,
      meta: { found: true, context: "inline" },
    };
  }

  const task = String(args.task ?? "").trim();
  const composed = [
    `You are executing the "${skill.name}" skill.`,
    body || skill.description,
    task ? `Task: ${task}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await runSubAgent({
    createAgent: deps.createAgent,
    provider: deps.provider,
    workspaceRoot: deps.workspaceRoot,
    agentDir: deps.agentDir,
    task: composed,
    onEvent: deps.onEvent,
    signal: ctx.signal,
    toolAllowlist: skill.allowedTools,
    role: "custom",
    systemPrompt: `You are executing the "${skill.name}" skill.`,
  });
  return {
    output: result.summary,
    meta: { found: true, context: "fork", completed: result.completed },
  };
}

export function createUseSkillTool(
  skills: SkillDefinition[],
  deps: {
    createAgent: AgentFactory;
    provider: LlmProvider;
    workspaceRoot: string;
    agentDir: string;
    onEvent?: AgentEventHandler;
  },
): Tool {
  return {
    name: "use_skill",
    description:
      "Load a skill's full instructions by name. Skills with context:fork run in an isolated sub-agent instead of returning instructions inline.",
    risk: "read_only",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Exact skill name from the available-skills list" },
        task: {
          type: "string",
          description: "For fork-context skills, the concrete task to hand off",
        },
      },
      required: ["skill"],
    },
    target(args) {
      return String(args.skill ?? "");
    },
    async execute(ctx, args) {
      return executeUseSkill(skills, deps, ctx, args);
    },
  };
}
