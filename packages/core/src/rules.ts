import fs from "node:fs/promises";
import path from "node:path";
import { resolveInWorkspace, toWorkspaceRelative, ToolError } from "@ninjacode/tools";
import type { AgentMode } from "./types.js";
import { isAssetEnabled, loadAssetConfig } from "./assetRegistry.js";
import {
  frontmatterBlock,
  parseFrontmatter,
  stringifyFrontmatter,
  toOptionalBool,
  toOptionalString,
  toStringArray,
} from "./frontmatter.js";
import { listFilesWithSuffix, readFileSafe, walkForFilenames } from "./fsScan.js";
import { toSlug } from "./slug.js";

export type RuleSourceKind =
  | "AGENTS.md"
  | "CLAUDE.md"
  | "AGENT.md"
  | "ninjacode-rules"
  | "cursor-rule"
  | "copilot-instructions"
  | "copilot-instructions-scoped";

/** One rule file that was discovered on disk, whether or not it was included. */
export interface RuleDiagnostic {
  kind: RuleSourceKind;
  /** Path relative to the workspace root. */
  path: string;
  included: boolean;
  /** Why it was skipped, if `included` is false. */
  reason?: string;
  /** Glob(s) this rule is scoped to, if declared via frontmatter (e.g. `.cursor/rules/*.mdc`, `applyTo`). */
  globs?: string[];
  /** Char length of the content actually included. */
  chars?: number;
}

export interface RuleDiscoveryResult {
  /** Concatenated rule text ready to inline into the system prompt. */
  text: string;
  diagnostics: RuleDiagnostic[];
}

function section(kind: RuleSourceKind, rel: string, body: string, globs?: string[]): string {
  const scope = globs?.length ? ` (scope: ${globs.join(", ")})` : "";
  return `# Rule [${kind}] ${rel}${scope}\n${body.trim()}`;
}

/**
 * Discover every rules/instructions source we understand across a workspace:
 *  - Nested AGENTS.md / CLAUDE.md / AGENT.md (any depth, bounded walk)
 *  - .ninjacode/rules/*.md (legacy convention)
 *  - .cursor/rules/*.mdc, honoring frontmatter `globs` / `alwaysApply`
 *  - .github/copilot-instructions.md
 *  - .github/instructions/*.instructions.md, honoring frontmatter `applyTo`
 *
 * Rules whose frontmatter declares a glob scope are still included in the
 * system prompt (we don't know the "current file" at prompt-build time) but
 * are annotated with their scope so the model — and the returned diagnostics
 * — know they're conditionally relevant rather than global.
 */
export async function discoverRules(workspaceRoot: string): Promise<RuleDiscoveryResult> {
  const config = await loadAssetConfig(workspaceRoot);
  const ctx: RuleLoadContext = {
    workspaceRoot,
    diagnostics: [],
    sections: [],
    // Rules turned off in the settings UI stay listed as diagnostics but are
    // dropped from the prompt text.
    isDisabled: (rel) => !isAssetEnabled(config, "rule", normalizeRulePath(rel)),
  };

  await loadNestedMarkdownRules(ctx);
  await loadNinjaCodeRulesDir(ctx);
  await loadCursorRules(ctx);
  await loadCopilotInstructions(ctx);
  await loadCopilotScopedInstructions(ctx);

  return { text: ctx.sections.join("\n\n"), diagnostics: ctx.diagnostics };
}

interface RuleLoadContext {
  workspaceRoot: string;
  diagnostics: RuleDiagnostic[];
  sections: string[];
  isDisabled(rel: string): boolean;
}

/** Rule paths are keyed with forward slashes so config files stay portable. */
export function normalizeRulePath(rel: string): string {
  return rel.split(path.sep).join("/");
}

/** True when the rule was skipped; also records the diagnostic. */
function skipIfDisabled(ctx: RuleLoadContext, kind: RuleSourceKind, rel: string): boolean {
  if (!ctx.isDisabled(rel)) return false;
  ctx.diagnostics.push({ kind, path: rel, included: false, reason: "disabled in settings" });
  return true;
}

async function loadNestedMarkdownRules(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics, sections } = ctx;
  const filenames = ["AGENTS.md", "CLAUDE.md", "AGENT.md"];
  const found = await walkForFilenames(workspaceRoot, filenames, { maxDepth: 6, maxResults: 40 });
  // Root-level files first, then nested (shallower paths first) for stable ordering.
  found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));

  for (const abs of found) {
    const rel = path.relative(workspaceRoot, abs);
    const kind = path.basename(abs) as RuleSourceKind;
    if (skipIfDisabled(ctx, kind, rel)) continue;
    const text = await readFileSafe(abs);
    if (text === null) {
      diagnostics.push({ kind, path: rel, included: false, reason: "read failed" });
      continue;
    }
    if (!text.trim()) {
      diagnostics.push({ kind, path: rel, included: false, reason: "empty file" });
      continue;
    }
    const isNested = path.dirname(abs) !== workspaceRoot;
    const label = isNested ? `${kind} (nested, scope: ${path.dirname(rel) || "."}/**)` : rel;
    sections.push(section(kind, label, text));
    diagnostics.push({ kind, path: rel, included: true, chars: text.trim().length });
  }
}

async function loadNinjaCodeRulesDir(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics, sections } = ctx;
  const dir = path.join(workspaceRoot, ".ninjacode", "rules");
  const files = await listFilesWithSuffix(dir, [".md"]);
  for (const abs of files) {
    const rel = path.relative(workspaceRoot, abs);
    if (skipIfDisabled(ctx, "ninjacode-rules", rel)) continue;
    const raw = await readFileSafe(abs);
    if (!raw?.trim()) {
      diagnostics.push({ kind: "ninjacode-rules", path: rel, included: false, reason: "empty file" });
      continue;
    }
    // These are authored by the settings UI, which stores metadata in frontmatter.
    const { data, body } = parseFrontmatter(raw);
    const globs = toStringArray(data.globs);
    const description = toOptionalString(data.description);
    const content = body.trim() || raw.trim();
    sections.push(
      section("ninjacode-rules", rel, content || description || "", globs.length ? globs : undefined),
    );
    diagnostics.push({
      kind: "ninjacode-rules",
      path: rel,
      included: true,
      globs: globs.length ? globs : undefined,
      chars: content.length,
    });
  }
}

async function loadCursorRules(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics, sections } = ctx;
  const dir = path.join(workspaceRoot, ".cursor", "rules");
  const files = await listFilesWithSuffix(dir, [".mdc", ".md"]);
  for (const abs of files) {
    const rel = path.relative(workspaceRoot, abs);
    if (skipIfDisabled(ctx, "cursor-rule", rel)) continue;
    const raw = await readFileSafe(abs);
    if (!raw?.trim()) {
      diagnostics.push({ kind: "cursor-rule", path: rel, included: false, reason: "empty file" });
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const globs = toStringArray(data.globs);
    const alwaysApply = toOptionalBool(data.alwaysApply);
    const description = toOptionalString(data.description);
    if (!body.trim() && !description) {
      diagnostics.push({ kind: "cursor-rule", path: rel, included: false, reason: "empty body" });
      continue;
    }
    const content = body.trim() || description || "";
    const note = alwaysApply === false && globs.length === 0 ? " (manual: agent-requested only)" : "";
    sections.push(section("cursor-rule", `${rel}${note}`, content, globs.length ? globs : undefined));
    diagnostics.push({
      kind: "cursor-rule",
      path: rel,
      included: true,
      globs: globs.length ? globs : undefined,
      chars: content.length,
    });
  }
}

async function loadCopilotInstructions(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics, sections } = ctx;
  const rel = path.join(".github", "copilot-instructions.md");
  const text = await readFileSafe(path.join(workspaceRoot, rel));
  if (text === null) return; // not present — not worth a diagnostic entry
  if (skipIfDisabled(ctx, "copilot-instructions", rel)) return;
  if (!text.trim()) {
    diagnostics.push({ kind: "copilot-instructions", path: rel, included: false, reason: "empty file" });
    return;
  }
  sections.push(section("copilot-instructions", rel, text));
  diagnostics.push({ kind: "copilot-instructions", path: rel, included: true, chars: text.trim().length });
}

async function loadCopilotScopedInstructions(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics, sections } = ctx;
  const dir = path.join(workspaceRoot, ".github", "instructions");
  const files = await listFilesWithSuffix(dir, [".instructions.md"]);
  for (const abs of files) {
    const rel = path.relative(workspaceRoot, abs);
    if (skipIfDisabled(ctx, "copilot-instructions-scoped", rel)) continue;
    const raw = await readFileSafe(abs);
    if (!raw?.trim()) {
      diagnostics.push({ kind: "copilot-instructions-scoped", path: rel, included: false, reason: "empty file" });
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const applyTo = toStringArray(data.applyTo);
    if (!body.trim()) {
      diagnostics.push({ kind: "copilot-instructions-scoped", path: rel, included: false, reason: "empty body" });
      continue;
    }
    sections.push(section("copilot-instructions-scoped", rel, body, applyTo.length ? applyTo : undefined));
    diagnostics.push({
      kind: "copilot-instructions-scoped",
      path: rel,
      included: true,
      globs: applyTo.length ? applyTo : undefined,
      chars: body.trim().length,
    });
  }
}

/** Where rules created from the UI are written. */
export const RULES_WRITE_DIR = path.join(".ninjacode", "rules");

export interface RuleInput {
  name: string;
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
  body: string;
  /** Existing workspace-relative file to overwrite. */
  path?: string;
}

/**
 * Create or update a rule file. New rules land in `.ninjacode/rules/<slug>.md`
 * with frontmatter metadata; editing an existing file (including AGENTS.md or a
 * `.cursor/rules/*.mdc`) writes back in place, preserving its own convention.
 * Returns the workspace-relative path written.
 */
export async function writeRule(workspaceRoot: string, input: RuleInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new ToolError("Rule name is required", "invalid_args");
  if (!input.body.trim()) throw new ToolError("Rule content is required", "invalid_args");

  const target = input.path
    ? resolveInWorkspace(workspaceRoot, input.path)
    : resolveInWorkspace(workspaceRoot, path.join(RULES_WRITE_DIR, `${toSlug(name, "rule")}.md`));
  const rel = toWorkspaceRelative(workspaceRoot, target);

  // Only our own files and `.mdc` rules use the description/globs/alwaysApply
  // convention. Elsewhere (AGENTS.md, Copilot instructions) we replace just the
  // body and keep any existing metadata block byte-for-byte.
  const ownsFrontmatter =
    !input.path ||
    normalizeRulePath(rel).startsWith(`${normalizeRulePath(RULES_WRITE_DIR)}/`) ||
    target.endsWith(".mdc");

  const content = ownsFrontmatter
    ? stringifyFrontmatter(
        { description: input.description, globs: input.globs, alwaysApply: input.alwaysApply },
        input.body,
      )
    : `${frontmatterBlock((await readFileSafe(target)) ?? "")}${input.body.trim()}\n`;

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return rel;
}

export async function deleteRule(workspaceRoot: string, rel: string): Promise<void> {
  await fs.rm(resolveInWorkspace(workspaceRoot, rel), { force: true });
}

/** Full text of a rule file, frontmatter stripped when it has one. */
export async function readRuleBody(
  workspaceRoot: string,
  rel: string,
): Promise<{ body: string; description?: string; globs?: string[]; alwaysApply?: boolean }> {
  const raw = (await readFileSafe(resolveInWorkspace(workspaceRoot, rel))) ?? "";
  const { data, body } = parseFrontmatter(raw);
  const globs = toStringArray(data.globs ?? data.applyTo);
  return {
    body: (body.trim() || raw.trim()).trim(),
    description: toOptionalString(data.description),
    globs: globs.length ? globs : undefined,
    alwaysApply: toOptionalBool(data.alwaysApply),
  };
}

/**
 * Load project rules from AGENTS.md/CLAUDE.md (nested), .cursor/rules/*.mdc,
 * .github/copilot-instructions.md, .github/instructions/*.instructions.md,
 * and the legacy .ninjacode/rules/ directory — concatenated into system-prompt text.
 * Use `discoverRules` instead when you also need per-source diagnostics.
 */
export async function loadProjectRules(workspaceRoot: string): Promise<string> {
  const { text } = await discoverRules(workspaceRoot);
  return text;
}

function debugModeInstructions(debugLogUrl?: string, agentDir?: string): string {
  const url = debugLogUrl ?? "(debug server URL unavailable)";
  const logFile = agentDir ? path.join(agentDir, "debug.log") : ".ninjacode/debug.log";
  return `You are in DEBUG mode. Do NOT guess fixes. Follow this evidence-driven loop strictly:

1. EXPLORE — read relevant code and error context.
2. HYPOTHESIZE — call record_hypotheses with 3–5 competing, testable root-cause hypotheses (ids H1, H2, …). Each must predict what logs would show if true.
3. INSTRUMENT — add temporary log statements that discriminate between hypotheses. Rules:
   - Wrap EVERY instrumentation block with markers on their own lines:
     // NINJACODE-DEBUG-START
     …logs…
     // NINJACODE-DEBUG-END
     (use language-appropriate comments: # for Python, /* */ for CSS, etc.)
   - Tag each log with the hypothesis it tests (hypothesisId: "H1", message: "[DEBUG H1] …").
   - Prefer POSTing JSON to the local debug server (works from any language):
     POST ${url}
     Body: {"hypothesisId":"H1","location":"file:line","message":"[DEBUG H1] …","data":{…}}
   - JS/TS snippet:
     // NINJACODE-DEBUG-START
     fetch(${JSON.stringify(url)},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hypothesisId:"H1",location:"file.ts:42",message:"[DEBUG H1] …",data:{value}})}).catch(()=>{});
     // NINJACODE-DEBUG-END
   - Python snippet:
     # NINJACODE-DEBUG-START
     import json,urllib.request
     urllib.request.urlopen(urllib.request.Request(${JSON.stringify(url)},data=json.dumps({"hypothesisId":"H1","location":"file.py:42","message":"[DEBUG H1] …","data":{}}).encode(),headers={"Content-Type":"application/json"},method="POST"))
     # NINJACODE-DEBUG-END
   - Fallback (no HTTP): append one NDJSON line to ${logFile}.
4. REPRODUCE — call clear_debug_logs, then ask_user with a clear reproduction checklist and wait. Options should include "Done — I reproduced it" / "Could not reproduce".
5. ANALYZE — call read_debug_logs. Classify each hypothesis as confirmed / rejected / inconclusive via record_hypotheses. Do NOT propose a fix until at least one hypothesis is confirmed by runtime evidence.
6. FIX — apply a minimal, targeted fix for the confirmed root cause only.
7. VERIFY — ask_user to reproduce again. If still broken, refine instrumentation and loop.
8. CLEAN UP — after the user confirms the fix, call cleanup_instrumentation to remove all NINJACODE-DEBUG blocks. Never leave instrumentation in the final diff.

Forbidden in DEBUG mode: speculative refactors, large rewrites, claiming a root cause without log evidence.`;
}

/**
 * Build the system prompt. Everything here must stay byte-stable for the whole
 * session: the prompt cache keys off this prefix, so mutable state (scratchpad,
 * plan) is injected into the message history instead — see `volatileContext.ts`.
 */
export function buildSystemPrompt(options: {
  mode: AgentMode;
  workspaceRoot: string;
  rules?: string;
  debugLogUrl?: string;
  agentDir?: string;
  /** Progressive-disclosure skill index: name + one-line description only (full body loaded on demand). */
  skills?: Array<{ name: string; description: string }>;
}): string {
  const modeInstructions =
    options.mode === "plan"
      ? `You are in PLAN mode (read-only). Explore the codebase, ask clarifying questions, and write a detailed implementation plan. Do NOT edit source files or run destructive shell commands. When a decision is genuinely the user's to make, use ask_user with 2–4 concrete clickable options per question, most relevant choice first — the UI marks it as (Recommended) — (the user can always type a free-form answer) instead of open-ended prose questions. If a step of the plan requires something you are not allowed to do (e.g. credentials, external services, privileged commands), plan an explicit pause: at execution time it will be handled with request_user_action. When the plan is ready, write the full final plan via write_plan (title + complete markdown body). This overwrites the session's plan — never create a second plan file. As the FINAL step of planning, also turn the plan into a concrete, ordered checklist with todo_write (merge=false): one todo per actionable step, each with a stable id, a short imperative content, and status "pending". This checklist is what will be tracked and updated while the plan is executed, so keep it aligned with the plan. Do NOT ask the user to switch modes — the UI provides an "Execute plan" button when the plan is ready. Never claim you lack write_file or that you can change modes yourself.`
      : options.mode === "ask"
        ? `You are in ASK mode (read-only Q&A). Answer questions about the codebase using read/search tools. Do not modify files.`
        : options.mode === "debug"
          ? debugModeInstructions(options.debugLogUrl, options.agentDir)
          : `You are in AGENT mode. Implement the user's request end-to-end: explore, edit files, run commands, verify. Prefer small precise edits via edit_file. Use todo_write for multi-step work. If a plan checklist already exists (e.g. from PLAN mode), reuse those todos instead of recreating them: mark a task in_progress (merge=true) right before you start it, and completed only once you have verified the outcome — keep exactly one task in_progress at a time.`;

  const interactionGuidelines = [
    `Interaction quality:`,
    `- Briefly state what you are about to do before calling tools (one short sentence). Never emit an empty assistant message when tools follow.`,
    `- Use workspace-relative paths only (e.g. src/app.ts, fluid-sim.html). Never pass absolute filesystem paths to tools.`,
    `- Mark todos completed only after you have verified the outcome (file exists, command succeeded, test passed).`,
    `- After writing or editing files, verify with read_file or a targeted shell command before concluding.`,
    `- Do NOT create or overwrite files via shell redirection (cat >, echo >>, heredocs). Always use write_file or edit_file.`,
    `- When a tool fails, diagnose the root cause from its output instead of blindly retrying the same call.`,
    `- Prefer write_file for new files; use edit_file for small targeted changes.`,
    `- For tabular data, use GitHub-flavored markdown tables (| Header | … |). Never use ASCII box tables inside code fences.`,
    `- For database or entity schemas, prefer \`\`\`mermaid blocks with erDiagram syntax instead of ASCII art.`,
    `- For architecture, flow, or dependency diagrams, use fenced \`\`\`mermaid blocks (graph/flowchart syntax). Do not use ASCII art diagrams.`,
    `- In mermaid node labels, double-quote any text containing @, /, or dashes: Node["@scope/pkg - label"].`,
    `- Stay concise and professional; avoid emoji unless the user uses them first.`,
  ].join("\n");

  const skillsBlock =
    options.skills && options.skills.length > 0
      ? `\nAvailable skills (call use_skill with the exact name to load full instructions):\n${options.skills
          .map((s) => `- ${s.name}: ${s.description}`)
          .join("\n")}`
      : "";

  return [
    `You are NinjaCode, a frontier agentic coding assistant.`,
    modeInstructions,
    `Workspace root: ${options.workspaceRoot}`,
    `Guidelines:`,
    `- Use tools to gather context before editing; never invent file contents.`,
    `- Keep the action space focused: read/search first, then edit, then verify with shell/tests.`,
    `- Your turn budget is finite. Reading is not progress: as soon as you can name the file and the lines to change, edit them. An imperfect edit you then verify and correct is worth more than more exploration.`,
    `- Search for the specific symbol or message you need instead of reading whole files. Re-reading a range you already have is almost never worth a turn; following a read_file pagination footer (continue with offset=N) to finish an unread portion is fine.`,
    `- Write durable notes with write_scratchpad so they survive context compaction.`,
    `- Ask the user via ask_user when blocked by an ambiguous decision. Always provide 2–4 concrete clickable options per question, most relevant choice first (the UI marks it as Recommended); the user can also answer with free text.`,
    `- When a step requires a manual action you cannot or are not allowed to perform (login, plug in hardware, privileged command, denied tool call), call request_user_action to pause the run; it resumes when the user confirms the action is done.`,
    `- Do not escape the workspace. Do not exfiltrate secrets.`,
    interactionGuidelines,
    options.rules ? `\nProject rules:\n${options.rules}` : "",
    skillsBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
