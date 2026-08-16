import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveModelPricing,
  type LlmProvider,
  type Message,
} from "@ninjacode/providers";
import type {
  CodebaseIndexLike,
  DiagnosticsProvider,
  SandboxMode,
  ToolContext,
} from "@ninjacode/tools";
import type { AgentEventHandler, ApprovalHandler, RunState } from "./types.js";
import type { PermissionEngine } from "./permissions.js";
import type { ToolCircuitBreaker } from "./reliability.js";
import type { HookRunResult } from "./hooks.js";
import {
  buildPersistedSession,
  loadSession,
  saveSession,
} from "./sessions.js";
import type { RequestCheckpoint, TurnTrace } from "./types.js";
import type { AgentFactory } from "./agentFactory.js";
import { modelForSubAgentRole, runSubAgent, type SubAgentRole } from "./subagents.js";
import {
  loadVerifyConfig,
  runVerification,
  type VerificationResult,
} from "./verify.js";
import { ToolPipeline } from "./toolPipeline.js";
import type { SubAgentOrchestrator } from "./subagentOrchestrator.js";
import { nodeProcessRunner } from "./nodePorts.js";
import type {
  ResolvedIndependentVerifierOptions,
  VerificationMode,
} from "./agentOptions.js";
import type { BudgetTracker } from "./reliability.js";

function trackModifiedFiles(
  modifiedFiles: Set<string>,
  toolName: string,
  meta?: Record<string, unknown>,
): void {
  const writeTools = new Set(["write_file", "edit_file", "apply_patch", "delete_file"]);
  if (!writeTools.has(toolName)) return;
  if (Array.isArray(meta?.paths)) {
    for (const p of meta.paths) if (typeof p === "string") modifiedFiles.add(p);
  }
  if (typeof meta?.path === "string") modifiedFiles.add(meta.path);
}

export async function runCompletionVerification(opts: {
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  sandboxMode: SandboxMode;
  signal: AbortSignal;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  modifiedFiles: Set<string>;
  config: Awaited<ReturnType<typeof loadVerifyConfig>>;
}): Promise<VerificationResult> {
  const ctx: ToolContext = {
    workspaceRoot: opts.workspaceRoot,
    agentDir: opts.agentDir,
    sessionId: opts.sessionId,
    planId: opts.planId,
    sandboxMode: opts.sandboxMode,
    signal: opts.signal,
    codebaseIndex: opts.codebaseIndex,
    diagnosticsProvider: opts.diagnosticsProvider,
  };
  return runVerification(ctx, opts.config, [...opts.modifiedFiles]);
}

export const INDEPENDENT_VERIFIER_SCHEMA_VERSION = "1.0" as const;

export interface IndependentVerifierIssue {
  severity: "error" | "warning";
  summary: string;
  evidence: string[];
}

export interface IndependentVerifierVerdict {
  schemaVersion: typeof INDEPENDENT_VERIFIER_SCHEMA_VERSION;
  lgtm: boolean;
  issues: IndependentVerifierIssue[];
  missingTests: string[];
  evidence: string[];
  confidence: number;
}

export interface IndependentVerifierEvidence {
  modifiedFiles: string[];
  diff: {
    text: string;
    available: boolean;
    truncated: boolean;
    changedLines: number;
  };
  diagnostics: VerificationResult["diagnostics"];
  commands: VerificationResult["commands"];
  local: Pick<VerificationResult, "ok" | "ambiguous" | "messages">;
}

export interface IndependentVerifierRunResult {
  invoked: boolean;
  trigger?: "current" | "blind" | "non_trivial_mutation" | "ambiguous_local_signal" | "local_failure";
  verdict?: IndependentVerifierVerdict;
  costUsd?: number;
  evidence: IndependentVerifierEvidence;
}

function normalizeModifiedFiles(workspaceRoot: string, modifiedFiles: Set<string>): string[] {
  return [...modifiedFiles]
    .map((file) => {
      const relative = path.isAbsolute(file) ? path.relative(workspaceRoot, file) : file;
      return relative.replaceAll("\\", "/").replace(/^\.\/+/u, "");
    })
    .filter((file) => file.length > 0 && file !== ".." && !file.startsWith("../"))
    .sort();
}

function boundText(value: string, limit: number): { text: string; truncated: boolean } {
  if (value.length <= limit) return { text: value, truncated: false };
  const marker = "\n… [diff truncated by verifier evidence budget]";
  return {
    text: `${value.slice(0, Math.max(0, limit - marker.length))}${marker}`,
    truncated: true,
  };
}

async function fallbackFileEvidence(
  workspaceRoot: string,
  files: string[],
  limit: number,
): Promise<string> {
  const chunks: string[] = [];
  let remaining = limit;
  for (const file of files) {
    if (remaining <= 0) break;
    try {
      const content = await fs.readFile(path.join(workspaceRoot, file), "utf8");
      const header = `--- unavailable baseline\n+++ ${file}\n`;
      const chunk = `${header}${content}`;
      chunks.push(chunk.slice(0, remaining));
      remaining -= chunk.length;
    } catch {
      chunks.push(`--- ${file}\n+++ deleted or unreadable\n`);
    }
  }
  return chunks.join("\n");
}

export async function collectIndependentVerifierEvidence(opts: {
  workspaceRoot: string;
  modifiedFiles: Set<string>;
  verification: VerificationResult;
  maxDiffChars: number;
}): Promise<IndependentVerifierEvidence> {
  const modifiedFiles = normalizeModifiedFiles(opts.workspaceRoot, opts.modifiedFiles);
  const diffResult = modifiedFiles.length === 0
    ? { code: 0, stdout: "", stderr: "" }
    : await nodeProcessRunner.run(
      "git",
      ["diff", "--no-ext-diff", "--unified=3", "HEAD", "--", ...modifiedFiles],
      {
        cwd: opts.workspaceRoot,
        signal: undefined,
        shell: false,
        sandbox: {
          workspaceRoot: opts.workspaceRoot,
          agentDir: path.join(opts.workspaceRoot, ".ninjacode"),
          mode: "read-only",
        },
      },
    ).catch((error) => ({
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }));
  const available = diffResult.code === 0;
  const rawDiff =
    diffResult.stdout.trim().length > 0
      ? diffResult.stdout
      : await fallbackFileEvidence(opts.workspaceRoot, modifiedFiles, opts.maxDiffChars);
  const bounded = boundText(rawDiff, opts.maxDiffChars);
  const changedLines = rawDiff
    .split("\n")
    .filter((line) =>
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---"))
    )
    .length;
  return {
    modifiedFiles,
    diff: {
      text: bounded.text,
      available,
      truncated: bounded.truncated,
      changedLines,
    },
    diagnostics: {
      checked: opts.verification.diagnostics.checked,
      entries: opts.verification.diagnostics.entries.slice(0, 25).map((entry) => ({
        ...entry,
        path: entry.path.slice(0, 500),
        message: entry.message.slice(0, 500),
        source: entry.source?.slice(0, 100),
      })),
    },
    commands: opts.verification.commands.slice(0, 20).map((command) => ({
      ...command,
      command: command.command.slice(0, 1_000),
      output: command.output.slice(0, 1_000),
    })),
    local: {
      ok: opts.verification.ok,
      ambiguous: opts.verification.ambiguous || (!available && rawDiff.length === 0),
      messages: opts.verification.messages.slice(0, 10).map((message) => message.slice(0, 1_000)),
    },
  };
}

function verifierTrigger(
  mode: VerificationMode,
  evidence: IndependentVerifierEvidence,
): IndependentVerifierRunResult["trigger"] | undefined {
  if (mode === "current") return "current";
  if (mode === "blind") return "blind";
  if (!evidence.local.ok) return "local_failure";
  if (evidence.local.ambiguous) return "ambiguous_local_signal";
  if (
    evidence.modifiedFiles.length > 1 ||
    evidence.diff.changedLines > 80 ||
    evidence.diff.truncated
  ) {
    return "non_trivial_mutation";
  }
  return undefined;
}

function malformedVerdict(reason: string): IndependentVerifierVerdict {
  return {
    schemaVersion: INDEPENDENT_VERIFIER_SCHEMA_VERSION,
    lgtm: false,
    issues: [{ severity: "warning", summary: reason, evidence: [] }],
    missingTests: [],
    evidence: [],
    confidence: 0,
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value.map((item) => item.slice(0, 2_000));
}

export function parseIndependentVerifierVerdict(value: string): IndependentVerifierVerdict {
  const candidate = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return malformedVerdict("Verifier returned malformed JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return malformedVerdict("Verifier verdict was not an object.");
  }
  const record = parsed as Record<string, unknown>;
  const missingTests = stringArray(record.missingTests);
  const evidence = stringArray(record.evidence);
  if (
    record.schemaVersion !== INDEPENDENT_VERIFIER_SCHEMA_VERSION ||
    typeof record.lgtm !== "boolean" ||
    !Array.isArray(record.issues) ||
    missingTests === undefined ||
    evidence === undefined ||
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence)
  ) {
    return malformedVerdict("Verifier verdict did not match schema 1.0.");
  }
  const issues: IndependentVerifierIssue[] = [];
  for (const issue of record.issues) {
    if (issue === null || typeof issue !== "object" || Array.isArray(issue)) {
      return malformedVerdict("Verifier issue did not match schema 1.0.");
    }
    const item = issue as Record<string, unknown>;
    const issueEvidence = stringArray(item.evidence);
    if (
      (item.severity !== "error" && item.severity !== "warning") ||
      typeof item.summary !== "string" ||
      issueEvidence === undefined
    ) {
      return malformedVerdict("Verifier issue did not match schema 1.0.");
    }
    issues.push({
      severity: item.severity,
      summary: item.summary.slice(0, 2_000),
      evidence: issueEvidence,
    });
  }
  return {
    schemaVersion: INDEPENDENT_VERIFIER_SCHEMA_VERSION,
    lgtm: record.lgtm && issues.length === 0 && missingTests.length === 0,
    issues,
    missingTests,
    evidence,
    confidence: Math.min(1, Math.max(0, record.confidence)),
  };
}

export async function runVerificationSubAgent(opts: {
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  onEvent?: AgentEventHandler;
  signal: AbortSignal;
  modifiedFiles: Set<string>;
  verification: VerificationResult;
  mode: VerificationMode;
  verifier: ResolvedIndependentVerifierOptions;
  utilityModel?: string;
  budget: BudgetTracker;
  createAgent: AgentFactory;
  orchestrator: SubAgentOrchestrator;
}): Promise<IndependentVerifierRunResult> {
  const evidence = await collectIndependentVerifierEvidence({
    workspaceRoot: opts.workspaceRoot,
    modifiedFiles: opts.modifiedFiles,
    verification: opts.verification,
    maxDiffChars: opts.verifier.maxDiffChars,
  });
  const trigger = verifierTrigger(opts.mode, evidence);
  if (!trigger) return { invoked: false, evidence };
  const task = [
    "Review only the supplied implementation evidence adversarially.",
    "You have no parent prompt, response, summary, conversation, or claimed intent. Do not ask for them.",
    `Evidence:\n${JSON.stringify(evidence)}`,
    "Return JSON only with this exact schema:",
    JSON.stringify({
      schemaVersion: INDEPENDENT_VERIFIER_SCHEMA_VERSION,
      lgtm: true,
      issues: [{ severity: "error", summary: "specific defect", evidence: ["diff or check fact"] }],
      missingTests: ["specific missing test"],
      evidence: ["facts supporting the verdict"],
      confidence: 0.9,
    }),
    "Use lgtm=true only when issues and missingTests are empty. Confidence must be between 0 and 1.",
  ].join("\n\n");
  const verifierModel = modelForSubAgentRole("verifier", { utilityModel: opts.utilityModel });
  const result = await runSubAgent({
    createAgent: opts.createAgent,
    provider: opts.provider,
    workspaceRoot: opts.workspaceRoot,
    agentDir: opts.agentDir,
    task,
    onEvent: opts.onEvent,
    signal: opts.signal,
    role: "verifier",
    model: verifierModel,
    maxTurns: opts.verifier.maxTurns,
    maxCostUsd: opts.verifier.maxCostUsd,
    timeoutMs: opts.verifier.timeoutMs,
    // The verifier is evidence-only: no workspace tool can escape this packet.
    toolAllowlist: [],
    orchestrator: opts.orchestrator,
  });
  const costBefore = opts.budget.estimatedCostUsd;
  opts.budget.add(result.usage, { pricing: resolveModelPricing(verifierModel) });
  return {
    invoked: true,
    trigger,
    verdict: parseIndependentVerifierVerdict(result.summary),
    costUsd: Math.max(0, opts.budget.estimatedCostUsd - costBefore),
    evidence,
  };
}

export async function runAdaptiveOrchestrationSubAgent(opts: {
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  onEvent?: AgentEventHandler;
  signal: AbortSignal;
  task: string;
  reason: string;
  role: Extract<SubAgentRole, "research" | "planner">;
  parentModel?: string;
  utilityModel?: string;
  createAgent: AgentFactory;
  orchestrator: SubAgentOrchestrator;
}): Promise<string> {
  const task = [
    `Adaptive orchestration signal: ${opts.reason}.`,
    "Investigate the parent task read-only and return only evidence that helps the parent choose its next action.",
    "Do not edit files, create branches, use worktrees, or propose speculative parallel implementations.",
    `Parent task:\n${opts.task}`,
  ].join("\n\n");
  const result = await runSubAgent({
    createAgent: opts.createAgent,
    provider: opts.provider,
    workspaceRoot: opts.workspaceRoot,
    agentDir: opts.agentDir,
    task,
    onEvent: opts.onEvent,
    signal: opts.signal,
    role: opts.role,
    model: modelForSubAgentRole(opts.role, {
      parentModel: opts.parentModel,
      utilityModel: opts.utilityModel,
    }),
    toolAllowlist: ["read_file", "grep", "glob", "list_dir", "search_codebase", "read_lints"],
    orchestrator: opts.orchestrator,
  });
  return result.summary;
}

export function createAgentToolPipeline(opts: {
  signal: AbortSignal;
  permissions: PermissionEngine;
  breaker: ToolCircuitBreaker;
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  sandboxMode: SandboxMode;
  persistSessionContext: boolean;
  parallelToolReads: boolean;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  onApproval?: ApprovalHandler;
  getState: () => RunState;
  setState: (next: RunState) => Promise<void>;
  runHooks: (
    event: HookRunResult["event"],
    input: { toolName?: string; arguments?: Record<string, unknown>; output?: string; error?: string },
  ) => Promise<HookRunResult[]>;
  emit: (type: "tool_start" | "tool_end" | "approval_required" | "debug_hypotheses", payload: unknown) => Promise<void>;
  logAgentEvent: (type: "tool_call" | "tool_result" | "cancel", summary: string, detail?: string) => void;
  waitOrAbort: <T>(promise: Promise<T>) => Promise<T>;
  isAbortError: (error: unknown) => boolean;
  modifiedFiles: Set<string>;
}): ToolPipeline {
  return new ToolPipeline({
    ...opts,
    onModifiedFiles: (toolName, meta) => trackModifiedFiles(opts.modifiedFiles, toolName, meta),
  });
}

export async function writeAgentSession(opts: {
  persistSessions: boolean;
  permissions: PermissionEngine;
  agentDir: string;
  sessionId: string;
  workspaceRoot: string;
  mode: import("./types.js").AgentMode;
  model?: string;
  providerName: string;
  createdAt: string;
  planId: string;
  history: Message[];
  turns: TurnTrace[];
  pinnedTask?: string;
  requests: RequestCheckpoint[];
}): Promise<void> {
  if (!opts.persistSessions) return;
  const grants = [...(opts.permissions.getPolicy().grants ?? [])];
  const existing = await loadSession(opts.agentDir, opts.sessionId).catch(() => null);
  const planId = existing?.config.planId ?? opts.planId;
  const state = buildPersistedSession({
    config: {
      id: opts.sessionId,
      workspaceRoot: opts.workspaceRoot,
      mode: opts.mode,
      model: opts.model,
      provider: opts.providerName.replace(/\+retry$/, ""),
      createdAt: opts.createdAt,
      planId,
    },
    history: opts.history,
    turns: opts.turns,
    grants,
    pinnedTask: opts.pinnedTask,
    title: existing?.title,
    pinned: existing?.pinned,
    archived: existing?.archived,
    requests: opts.requests,
  });
  await saveSession(opts.agentDir, state);
}
