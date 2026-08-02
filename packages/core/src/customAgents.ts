import fs from "node:fs/promises";
import path from "node:path";
import type { LlmProvider } from "@ninjacode/providers";
import { resolveInWorkspace, toWorkspaceRelative, ToolError, type Tool } from "@ninjacode/tools";
import { isAssetEnabled, loadAssetConfig } from "./assetRegistry.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  toOptionalString,
  toStringArray,
} from "./frontmatter.js";
import { listFilesWithSuffix, readFileSafe } from "./fsScan.js";
import { toSlug, toToolNameFragment } from "./slug.js";
import type { AgentFactory } from "./agentFactory.js";
import { runSubAgent } from "./subagents.js";
import type { AgentEventHandler } from "./types.js";

/**
 * A named custom agent persona loaded from `.github/agents/*.agent.md`,
 * `.claude/agents/*.md` or `.ninjacode/agents/*.md`.
 */
export interface CustomAgentDefinition {
  name: string;
  description?: string;
  model?: string;
  /** Tool names this agent is restricted to, or undefined/["*"] for "all tools". */
  tools?: string[];
  /** Names of other custom agents this one is allowed to hand off to. */
  handoffs?: string[];
  /** System-prompt body (frontmatter stripped). */
  systemPrompt: string;
  path: string;
  /** Workspace-relative directory this agent came from (e.g. `.ninjacode/agents`). */
  source: string;
  /** False when disabled in `.ninjacode/config.json`: still listed, never registered. */
  enabled: boolean;
}

interface AgentDirSpec {
  /** Workspace-relative directory. */
  rel: string;
  suffixes: string[];
}

/** Where custom agents created from the UI are written. */
export const AGENTS_WRITE_DIR = ".ninjacode/agents";

/** Last entry wins on name collisions, so `.ninjacode/agents` overrides the others. */
function projectAgentDirs(): AgentDirSpec[] {
  return [
    { rel: path.join(".github", "agents"), suffixes: [".agent.md"] },
    { rel: path.join(".claude", "agents"), suffixes: [".md"] },
    { rel: path.join(".ninjacode", "agents"), suffixes: [".md"] },
  ];
}

function nameFromFile(filePath: string, suffixes: string[]): string {
  const base = path.basename(filePath);
  for (const suf of suffixes) {
    if (base.endsWith(suf)) return base.slice(0, -suf.length);
  }
  return base.replace(/\.md$/, "");
}

async function loadFromSpec(
  workspaceRoot: string,
  spec: AgentDirSpec,
): Promise<CustomAgentDefinition[]> {
  const files = await listFilesWithSuffix(path.join(workspaceRoot, spec.rel), spec.suffixes);
  const out: CustomAgentDefinition[] = [];
  for (const file of files) {
    const raw = await readFileSafe(file);
    if (raw === null || !raw.trim()) continue;
    const { data, body } = parseFrontmatter(raw);
    if (!body.trim()) continue;
    const tools = toStringArray(data.tools);
    out.push({
      name: toOptionalString(data.name) ?? nameFromFile(file, spec.suffixes),
      description: toOptionalString(data.description),
      model: toOptionalString(data.model),
      tools: tools.length ? tools : undefined,
      handoffs: toStringArray(data.handoffs),
      systemPrompt: body.trim(),
      path: file,
      source: spec.rel,
      enabled: true,
    });
  }
  return out;
}

/**
 * Load custom agent personas from `.github/agents/*.agent.md`,
 * `.claude/agents/*.md` and `.ninjacode/agents/*.md`. Later directories win on
 * name collisions.
 *
 * Agents disabled in `.ninjacode/config.json` come back with `enabled: false`
 * instead of being dropped, so the settings UI can list them; use
 * `enabledCustomAgents` for anything that feeds the agent.
 */
export async function loadCustomAgents(workspaceRoot: string): Promise<CustomAgentDefinition[]> {
  const [lists, config] = await Promise.all([
    Promise.all(projectAgentDirs().map((spec) => loadFromSpec(workspaceRoot, spec))),
    loadAssetConfig(workspaceRoot),
  ]);
  const byName = new Map<string, CustomAgentDefinition>();
  for (const list of lists) {
    for (const a of list) {
      byName.set(a.name, { ...a, enabled: isAssetEnabled(config, "agent", a.name) });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The subset of loaded agents that may be turned into handoff tools. */
export function enabledCustomAgents(agents: CustomAgentDefinition[]): CustomAgentDefinition[] {
  return agents.filter((a) => a.enabled);
}

export interface CustomAgentInput {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  systemPrompt: string;
  /** Existing file to overwrite (rename/move stays out of scope). */
  path?: string;
}

/** File name derived from an agent name: safe on every filesystem. */
/**
 * Create or update a custom agent. New ones land in `.ninjacode/agents/<slug>.md`;
 * editing an existing one writes back to its own file.
 * Returns the workspace-relative path written.
 */
export async function writeCustomAgent(
  workspaceRoot: string,
  input: CustomAgentInput,
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new ToolError("Agent name is required", "invalid_args");
  if (!input.systemPrompt.trim()) {
    throw new ToolError("Agent instructions are required", "invalid_args");
  }
  const target = input.path
    ? resolveInWorkspace(workspaceRoot, input.path)
    : resolveInWorkspace(
        workspaceRoot,
        path.join(AGENTS_WRITE_DIR, `${toSlug(name, "agent")}.md`),
      );

  const content = stringifyFrontmatter(
    {
      name,
      description: input.description,
      model: input.model,
      tools: input.tools,
    },
    input.systemPrompt,
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return toWorkspaceRelative(workspaceRoot, target);
}

export async function deleteCustomAgent(workspaceRoot: string, file: string): Promise<void> {
  await fs.rm(resolveInWorkspace(workspaceRoot, file), { force: true });
}

/**
 * Build one "handoff" tool per custom agent so the primary agent can delegate
 * a task to a named persona. Reuses the existing isolated sub-agent runner
 * (`runSubAgent`) rather than a bespoke execution path — the persona's system
 * prompt is folded into the sub-agent's task text, and sub-agents already run
 * with `enableSubagents: false`, so handoffs can't recurse indefinitely.
 */
export function createCustomAgentHandoffTools(
  agents: CustomAgentDefinition[],
  deps: {
    createAgent: AgentFactory;
    provider: LlmProvider;
    workspaceRoot: string;
    agentDir: string;
    onEvent?: AgentEventHandler;
  },
): Tool[] {
  return agents.map((agent) => ({
    name: `agent_${toToolNameFragment(agent.name).toLowerCase()}`,
    description: `Hand off to the "${agent.name}" custom agent.${
      agent.description ? ` ${agent.description}` : ""
    }`.trim(),
    risk: "read_only" as const,
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: `Task to hand off to "${agent.name}"` },
      },
      required: ["task"],
    },
    target(args: Record<string, unknown>) {
      return String(args.task ?? "").slice(0, 80);
    },
    async execute(ctx, args) {
      const task = String(args.task ?? "").trim();
      if (!task) return { output: "Error: provide a task", meta: {} };
      const composed = [
        `You are acting as the "${agent.name}" custom agent.`,
        agent.systemPrompt,
        agent.tools?.length ? `You should only need these tools: ${agent.tools.join(", ")}.` : "",
        `Task: ${task}`,
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
        model: agent.model,
        toolAllowlist: agent.tools,
        role: "custom",
        systemPrompt: `You are acting as the "${agent.name}" custom agent.\n${agent.systemPrompt}`,
      });
      return {
        output: result.summary,
        meta: { agent: agent.name, completed: result.completed },
      };
    },
  }));
}
