import fs from "node:fs/promises";
import path from "node:path";
import { matchGlob, resolveInWorkspace, toWorkspaceRelative, ToolError } from "@ninjacode/tools";
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

interface RuleDiscoveryOptions {
  /**
   * Workspace-relative active or touched files. Scoped rules are excluded when
   * this set is absent, because applying an unrelated rule is less safe.
   */
  activeFiles?: readonly string[];
  /** Return only matching scoped rules for volatile message injection. */
  scopedOnly?: boolean;
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
 * Scoped rules are included only when at least one supplied active/touched file
 * matches. With no file set, only global rules are returned.
 */
export async function discoverRules(
  workspaceRoot: string,
  options: RuleDiscoveryOptions = {},
): Promise<RuleDiscoveryResult> {
  const config = await loadAssetConfig(workspaceRoot);
  const ctx: RuleLoadContext = {
    workspaceRoot,
    diagnostics: [],
    sections: [],
    activeFiles: options.activeFiles?.map(normalizeRulePath).filter(Boolean),
    scopedOnly: options.scopedOnly ?? false,
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
  activeFiles?: string[];
  scopedOnly: boolean;
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

function addRule(
  ctx: RuleLoadContext,
  rule: {
    kind: RuleSourceKind;
    rel: string;
    content: string;
    globs?: string[];
    reason?: string;
  },
): void {
  const normalizedGlobs = rule.globs?.map(normalizeRulePath).filter(Boolean);
  const skipReason = rule.reason ?? scopeSkipReason(ctx, normalizedGlobs);
  if (skipReason) {
    ctx.diagnostics.push({
      kind: rule.kind,
      path: rule.rel,
      included: false,
      reason: skipReason,
      globs: normalizedGlobs,
    });
    return;
  }
  ctx.sections.push(section(rule.kind, rule.rel, rule.content, normalizedGlobs));
  ctx.diagnostics.push({
    kind: rule.kind,
    path: rule.rel,
    included: true,
    globs: normalizedGlobs,
    chars: rule.content.trim().length,
  });
}

function scopeSkipReason(ctx: RuleLoadContext, globs?: string[]): string | undefined {
  if (!globs?.length) return ctx.scopedOnly ? "unscoped rule excluded from dynamic view" : undefined;
  if (!ctx.activeFiles?.length) return "scope requires active files";
  const matches = ctx.activeFiles.some((file) => globs.some((glob) => matchGlob(file, glob)));
  return matches ? undefined : "scope does not match active files";
}

async function loadNestedMarkdownRules(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics } = ctx;
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
    const globs = isNested ? [`${normalizeRulePath(path.dirname(rel))}/**`] : undefined;
    addRule(ctx, { kind, rel, content: text, globs });
  }
}

async function loadNinjaCodeRulesDir(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics } = ctx;
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
    addRule(ctx, {
      kind: "ninjacode-rules",
      rel,
      content: content || description || "",
      globs: globs.length ? globs : undefined,
    });
  }
}

async function loadCursorRules(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics } = ctx;
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
    const scope = alwaysApply === true ? undefined : globs.length ? globs : undefined;
    const manualReason =
      alwaysApply === false && globs.length === 0 ? "manual rule requires explicit request" : undefined;
    addRule(ctx, {
      kind: "cursor-rule",
      rel,
      content,
      globs: scope,
      reason: manualReason,
    });
  }
}

async function loadCopilotInstructions(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics } = ctx;
  const rel = path.join(".github", "copilot-instructions.md");
  const text = await readFileSafe(path.join(workspaceRoot, rel));
  if (text === null) return; // not present — not worth a diagnostic entry
  if (skipIfDisabled(ctx, "copilot-instructions", rel)) return;
  if (!text.trim()) {
    diagnostics.push({ kind: "copilot-instructions", path: rel, included: false, reason: "empty file" });
    return;
  }
  addRule(ctx, { kind: "copilot-instructions", rel, content: text });
}

async function loadCopilotScopedInstructions(ctx: RuleLoadContext): Promise<void> {
  const { workspaceRoot, diagnostics } = ctx;
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
    addRule(ctx, {
      kind: "copilot-instructions-scoped",
      rel,
      content: body,
      globs: applyTo.length ? applyTo : undefined,
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
      ? [
          `You are in PLAN mode (read-only). Investigate just enough to write a concrete plan, then stop. Do NOT edit source files or run destructive shell commands.`,
          `As soon as you can name the files to change and the approach, call write_plan (title + complete markdown body) AND todo_write (merge=false: one todo per actionable step, stable id, short imperative content, status "pending") in the SAME turn. This overwrites the session's plan — never create a second plan file. Do not spend extra turns reconfirming a hypothesis you already stated; finish planning within about 8 exploration turns.`,
          `After write_plan (with todo_write in the same turn), end the turn — the harness stops the run. Do not mark todos in_progress, do not start implementing, and do not call request_user_action to ask the user to execute.`,
          `Follow-up user messages may update the plan by calling write_plan again; only the UI "Execute plan" button starts implementation.`,
          `Use ask_user only when a decision is genuinely the user's to make, with 2–4 concrete clickable options per question, most relevant choice first — the UI marks it as (Recommended) — (the user can always type a free-form answer). If a step requires credentials, external services, or privileged commands, plan an explicit pause: at execution time it will be handled with request_user_action.`,
          `If the delegate tool is available and you need to investigate 2+ independent areas, call it with tasks[] in parallel and plan from the summaries instead of dumping every read into this conversation.`,
          `Do NOT ask the user to switch modes — the UI provides an "Execute plan" button when the plan is ready. Never claim you lack write_file or that you can change modes yourself.`,
        ].join(" ")
      : options.mode === "ask"
        ? `You are in ASK mode (read-only Q&A). Answer questions about the codebase using read/search tools. Do not modify files.`
        : options.mode === "debug"
          ? debugModeInstructions(options.debugLogUrl, options.agentDir)
          : [
              `You are in AGENT mode. Implement the user's request end-to-end: explore just enough, edit, verify with lints or tests, then stop.`,
              `On the first turn, batch independent discovery in parallel: list the workspace, inspect cited artifacts with a compact analysis command, and name the output file. Do not paginate a data or image file.`,
              `Make coherent edits: group related changes into one edit_file, apply_patch, or write_file call rather than many tiny replacements. Prefer apply_patch when that tool is available (multi-hunk / multi-file); otherwise use edit_file for targeted replacements and write_file for new files.`,
              `Use todo_write for multi-step work in the SAME turn as the work itself — never a turn whose only tool call is todo_write. If a plan checklist already exists, reuse those todos (merge=true). Keep at most one task in_progress; mark it in_progress as you start the work and completed after lints/tests succeed, not in a separate round-trip.`,
            ].join(" ");

  const interactionGuidelines = [
    `Interaction quality:`,
    `- Briefly state what you are about to do before calling tools (one short sentence). Never emit an empty assistant message when tools follow.`,
    `- Use workspace-relative paths only (e.g. src/app.ts, fluid-sim.html). Never pass absolute filesystem paths to tools.`,
    `- Mark todos completed only after you have verified the outcome (lint/test/command succeeded), in the same turn as that verification when possible.`,
    `- After a successful edit, do NOT read_file the result. Verify with read_lints or a targeted test. Re-read only when a tool failed.`,
    `- Do NOT create or overwrite files via shell redirection (cat >, echo >>, heredocs). Always use write_file, edit_file, or apply_patch.`,
    `- When a tool fails, diagnose the root cause from its output instead of blindly retrying the same call.`,
    `- Prefer write_file for new files; edit_file or apply_patch for existing files — whichever of those tools you have.`,
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
    `- Call independent read/search tools in parallel in one turn (several read_file, grep, and glob calls together).`,
    `- Use tools to gather context before editing; grep plus one targeted read is enough — do not map an entire package. Never invent file contents.`,
    `- Do not read image, binary, or large data files (ppm, png, wav, …) into context. Inspect them with a short run_shell command that prints compact stats (shape, dtype, header), not pixels or raw bytes.`,
    `- Your turn budget is finite. Reading is not progress: as soon as you can name the file and the change, edit. An imperfect edit you then verify and correct is worth more than more exploration.`,
    `- Prefer the grep tool (it returns surrounding lines) over run_shell with rg/grep. Prefer grep, glob, and search_codebase over shell for search.`,
    `- Read a file in full when it fits in one read_file call (~40k chars). Do not pass small limit values (40–80) "to be safe". Only paginate when the tool footer says the result was truncated.`,
    `- Re-reading a file already in this conversation is almost never worth a turn. After a successful write/edit, do not read_file it back.`,
    `- If the delegate tool is available and you need 2+ independent research threads, call it with tasks[] instead of loading every file into this conversation.`,
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
