import type { ToolInvocation } from "./types.js";
import type { ToolErrorCategory } from "./toolErrors.js";

export type OrchestrationProfile = "legacy" | "adaptive";
export type AgentPhase = "explore" | "execute" | "verify" | "recover";
export type TaskComplexity = "simple" | "medium" | "complex";
export type PhaseProgressGoal = "edit" | "plan";
export type AdaptiveDelegationRole = "research" | "planner";

export interface AdaptiveOrchestrationOptions {
  /** Automatically launch one bounded, read-only planner/research child when justified. */
  automaticDelegation?: boolean;
  /** Parent-run ceiling; child concurrency, cost and turns remain governed separately. */
  maxAutomaticDelegations?: number;
  /** Multiplier for exploration budgets, bounded so it can never expand maxTurns. */
  explorationBudgetScale?: number;
}

export interface ResolvedAdaptiveOrchestrationOptions {
  automaticDelegation: boolean;
  maxAutomaticDelegations: number;
  explorationBudgetScale: number;
}

export interface PhaseTransition {
  from?: AgentPhase;
  to: AgentPhase;
  turn: number;
  reason: string;
}

export interface AdaptiveDelegationDecision {
  role: AdaptiveDelegationRole;
  reason: "independent_areas" | "repeated_reads" | "exploration_budget";
}

export interface PhasePolicyState {
  phase: AgentPhase;
  phaseStartedTurn: number;
  complexity: TaskComplexity;
  explorationBudget: number;
  maxTurns: number;
  goal: PhaseProgressGoal;
  options: ResolvedAdaptiveOrchestrationOptions;
  mutationCount: number;
  readCount: number;
  rereadCount: number;
  readOnlyTurns: number;
  independentAreas: string[];
  automaticDelegations: number;
  verificationRecoveryCycles: number;
  recoveryCycles: number;
  initialTransitionPending: boolean;
  explorationClosed: boolean;
  readTargets: Record<string, number>;
}

interface PhaseTurnDecision {
  transition?: PhaseTransition;
  guidance?: string;
  delegation?: AdaptiveDelegationDecision;
  terminalFailure?: string;
}

interface VerificationPhaseDecision {
  transition?: PhaseTransition;
  retry: boolean;
  terminalFailure?: string;
}

const READ_TOOLS = new Set(["read_file", "list_dir", "glob", "grep", "search_codebase"]);
const WRITE_TOOLS = new Set(["apply_patch", "edit_file", "write_file", "delete_file"]);
const VERIFY_TOOLS = new Set(["read_lints", "get_errors"]);
const RECOVERABLE_ERROR_CATEGORIES = new Set<ToolErrorCategory>([
  "Unknown",
  "InvalidArguments",
  "UnexpectedEnvironment",
  "ProviderError",
  "Timeout",
  "NotFound",
  "CircuitOpen",
  "BlockedByHook",
]);

export const DEFAULT_ADAPTIVE_ORCHESTRATION: ResolvedAdaptiveOrchestrationOptions = Object.freeze({
  automaticDelegation: true,
  maxAutomaticDelegations: 1,
  explorationBudgetScale: 1,
});

export function resolveAdaptiveOrchestrationOptions(
  options: AdaptiveOrchestrationOptions = {},
): ResolvedAdaptiveOrchestrationOptions {
  const requestedDelegations = options.maxAutomaticDelegations;
  const requestedScale = options.explorationBudgetScale;
  return {
    automaticDelegation: options.automaticDelegation ?? true,
    maxAutomaticDelegations:
      requestedDelegations != null && Number.isFinite(requestedDelegations)
        ? Math.min(2, Math.max(0, Math.floor(requestedDelegations)))
        : DEFAULT_ADAPTIVE_ORCHESTRATION.maxAutomaticDelegations,
    explorationBudgetScale:
      requestedScale != null && Number.isFinite(requestedScale)
        ? Math.min(1.5, Math.max(0.5, requestedScale))
        : DEFAULT_ADAPTIVE_ORCHESTRATION.explorationBudgetScale,
  };
}

export function classifyTaskComplexity(task: string): TaskComplexity {
  const fileReferences = new Set(
    task.match(/(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+|[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|json|yaml|yml)/giu) ?? [],
  );
  const multiAreaSignals = countMatches(
    task,
    /\b(multi[- ]?file|across|plusieurs|multiple|integration|intégration|refactor|migration|orchestrat|wiring|end[- ]to[- ]end)\b/giu,
  );
  const requestedActions = countMatches(
    task,
    /\b(add|ajout|implement|implément|replace|remplac|modify|modifi|test|verify|vérifi|wire|branch|connect)\w*/giu,
  );

  if (fileReferences.size >= 3 || multiAreaSignals >= 2 || requestedActions >= 6) return "complex";
  if (fileReferences.size >= 2 || multiAreaSignals >= 1 || requestedActions >= 3) return "medium";
  return "simple";
}

export function explorationBudgetFor(
  complexity: TaskComplexity,
  maxTurns: number,
  scale = 1,
): number {
  const base = complexity === "simple" ? 3 : complexity === "medium" ? 6 : 9;
  const scaled = Math.max(1, Math.round(base * Math.min(1.5, Math.max(0.5, scale))));
  return Math.min(scaled, Math.max(1, Math.floor(maxTurns) - 2));
}

export function createPhasePolicyState(input: {
  task: string;
  maxTurns: number;
  goal: PhaseProgressGoal;
  options?: AdaptiveOrchestrationOptions | ResolvedAdaptiveOrchestrationOptions;
}): PhasePolicyState {
  const options = resolveAdaptiveOrchestrationOptions(input.options);
  const complexity = classifyTaskComplexity(input.task);
  return {
    phase: "explore",
    phaseStartedTurn: 0,
    complexity,
    explorationBudget: explorationBudgetFor(complexity, input.maxTurns, options.explorationBudgetScale),
    maxTurns: input.maxTurns,
    goal: input.goal,
    options,
    mutationCount: 0,
    readCount: 0,
    rereadCount: 0,
    readOnlyTurns: 0,
    independentAreas: [],
    automaticDelegations: 0,
    verificationRecoveryCycles: 0,
    recoveryCycles: 0,
    initialTransitionPending: true,
    explorationClosed: false,
    readTargets: {},
  };
}

export function takeInitialPhaseTransition(state: PhasePolicyState): PhaseTransition | undefined {
  if (!state.initialTransitionPending) return undefined;
  state.initialTransitionPending = false;
  return {
    to: "explore",
    turn: 0,
    reason: `initial_${state.complexity}`,
  };
}

export function observePhaseTurn(
  state: PhasePolicyState,
  invocations: ToolInvocation[],
  turn: number,
): PhaseTurnDecision {
  let mutation = false;
  let verification = false;
  let verificationFailed = false;
  let firstRecoverableError: ToolErrorCategory | undefined;

  for (const invocation of invocations) {
    const name = invocation.toolCall.name;
    const success = invocationSucceeded(invocation);
    const isMutation = mutationTool(state.goal, name);
    const isVerification = verificationTool(invocation);
    mutation ||= isMutation && success;
    verification ||= isVerification;
    verificationFailed ||= isVerification && !success;
    if (isMutation && success) state.mutationCount += 1;
    if (success) {
      observeRead(state, invocation);
      if (name === "run_shell") {
        for (const target of extractShellReadTargets(String(invocation.toolCall.arguments.command ?? ""))) {
          observeReadTarget(state, target);
        }
      }
    }
    const category = invocationErrorCategory(invocation);
    if (!firstRecoverableError && category && RECOVERABLE_ERROR_CATEGORIES.has(category)) {
      firstRecoverableError = category;
    }
  }

  if (!mutation) state.readOnlyTurns += 1;
  if (turn >= state.explorationBudget) state.explorationClosed = true;

  if (verificationFailed) {
    return verificationFailureDecision(state, turn, "tool_verification_failed");
  }

  if (firstRecoverableError) {
    const transition = transitionTo(state, "recover", turn, `tool_${firstRecoverableError}`);
    state.recoveryCycles += transition ? 1 : 0;
    return {
      transition,
      guidance: recoveryGuidance(firstRecoverableError),
    };
  }

  if (state.phase === "recover" && invocations.some(invocationSucceeded)) {
    const next = state.mutationCount > 0 || state.explorationClosed ? "execute" : "explore";
    return {
      transition: transitionTo(state, next, turn, "recovery_action_succeeded"),
      guidance:
        next === "execute"
          ? "Recovery succeeded. Continue the smallest safe implementation, then verify it."
          : "Recovery succeeded. Use the new evidence and avoid repeating the failed call.",
    };
  }

  if (mutation) {
    return {
      transition: transitionTo(state, "execute", turn, "workspace_mutated"),
    };
  }

  if (verification && state.mutationCount > 0) {
    return {
      transition: transitionTo(state, "verify", turn, "verification_tool"),
    };
  }

  const delegation = state.explorationClosed ? undefined : delegationDecision(state, turn);
  if (delegation) {
    return {
      delegation,
      guidance: explorationGuidance(state, turn),
    };
  }

  if ((state.phase === "explore" || state.phase === "recover") && state.explorationClosed) {
    return {
      transition: transitionTo(state, "execute", turn, "exploration_budget_exhausted"),
      guidance: explorationGuidance(state, turn),
    };
  }

  return {};
}

export function markAutomaticDelegation(state: PhasePolicyState): void {
  state.automaticDelegations += 1;
}

export function enterVerificationPhase(
  state: PhasePolicyState,
  turn: number,
  reason = "completion_verification",
): PhaseTransition | undefined {
  return transitionTo(state, "verify", turn, reason);
}

export function recordVerificationFailure(
  state: PhasePolicyState,
  turn: number,
  reason = "completion_verification_failed",
): VerificationPhaseDecision {
  return verificationFailureDecision(state, turn, reason);
}

function verificationFailureDecision(
  state: PhasePolicyState,
  turn: number,
  reason: string,
): PhaseTurnDecision & VerificationPhaseDecision {
  if (state.verificationRecoveryCycles >= 2) {
    return {
      retry: false,
      terminalFailure: "Verification failed again after two adaptive correction-verification cycles.",
    };
  }
  state.verificationRecoveryCycles += 1;
  state.recoveryCycles += 1;
  return {
    retry: true,
    transition: transitionTo(state, "recover", turn, reason),
    guidance:
      `Verification failed. Use correction cycle ${state.verificationRecoveryCycles}/2 ` +
      "to fix the evidenced issue, then verify once more.",
  };
}

function delegationDecision(
  state: PhasePolicyState,
  turn: number,
): AdaptiveDelegationDecision | undefined {
  if (
    !state.options.automaticDelegation ||
    state.automaticDelegations >= state.options.maxAutomaticDelegations ||
    state.mutationCount > 0
  ) {
    return undefined;
  }
  if (state.independentAreas.length >= 2) {
    return { role: "planner", reason: "independent_areas" };
  }
  if (state.rereadCount >= 2) {
    return { role: "research", reason: "repeated_reads" };
  }
  if (turn >= state.explorationBudget) {
    return {
      role: state.complexity === "complex" ? "planner" : "research",
      reason: "exploration_budget",
    };
  }
  return undefined;
}

function explorationGuidance(state: PhasePolicyState, turn: number): string {
  const action = state.goal === "plan" ? "write the plan" : "make the smallest justified edit";
  return (
    `Adaptive exploration budget reached at turn ${turn}/${state.maxTurns} ` +
    `(${state.complexity}, budget ${state.explorationBudget}). Use current evidence to ${action}; ` +
    "do not spend additional turns reconfirming the same hypothesis."
  );
}

function recoveryGuidance(category: ToolErrorCategory): string {
  const action =
    category === "Timeout"
      ? "narrow the operation or use a cheaper deterministic check"
      : category === "CircuitOpen"
        ? "switch tools or use already collected evidence; do not call the open circuit again"
        : category === "InvalidArguments"
          ? "correct the arguments from the classified error before one changed call"
          : "change approach using the classified recovery hint";
  return `Adaptive recovery (${category}): ${action}. Preserve successful work and avoid an unchanged retry.`;
}

function transitionTo(
  state: PhasePolicyState,
  next: AgentPhase,
  turn: number,
  reason: string,
): PhaseTransition | undefined {
  if (state.phase === next) return undefined;
  const transition = { from: state.phase, to: next, turn, reason };
  state.phase = next;
  state.phaseStartedTurn = turn;
  return transition;
}

function observeRead(state: PhasePolicyState, invocation: ToolInvocation): void {
  if (!READ_TOOLS.has(invocation.toolCall.name)) return;
  const target = readTarget(invocation);
  if (!target) {
    state.readCount += 1;
    return;
  }
  observeReadTarget(state, target);
}

function observeReadTarget(state: PhasePolicyState, target: string): void {
  state.readCount += 1;
  const seen = state.readTargets[target] ?? 0;
  if (seen > 0) state.rereadCount += 1;
  state.readTargets[target] = seen + 1;
  const area = independentArea(target);
  if (area && !state.independentAreas.includes(area)) {
    state.independentAreas.push(area);
    state.independentAreas.sort();
    if (state.independentAreas.length >= 2 && state.complexity !== "complex") {
      state.complexity = "complex";
      state.explorationBudget = Math.max(
        state.explorationBudget,
        explorationBudgetFor("complex", state.maxTurns, state.options.explorationBudgetScale),
      );
    }
  }
}

/** File-like tokens in a shell command, used to detect rereads of the same artefact. */
export function extractShellReadTargets(command: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:^|[\s'"=])(\.?\.?\/?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8})/g;
  for (const match of command.matchAll(pattern)) {
    const raw = match[1]?.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (raw) found.add(raw);
  }
  return [...found];
}

function readTarget(invocation: ToolInvocation): string | undefined {
  const args = invocation.toolCall.arguments;
  const value = args.path ?? args.file ?? args.directory;
  return typeof value === "string" && value.trim() ? value.replaceAll("\\", "/") : undefined;
}

function independentArea(target: string): string | undefined {
  const parts = target.split("/").filter(Boolean);
  for (const marker of ["packages", "apps", "src", "test", "tests"]) {
    const index = parts.lastIndexOf(marker);
    if (index >= 0 && parts[index + 1]) return `${marker}/${parts[index + 1]}`;
  }
  return parts.length >= 2 ? parts.slice(-2, -1)[0] : parts[0];
}

function mutationTool(goal: PhaseProgressGoal, name: string): boolean {
  return goal === "plan" ? name === "write_plan" : WRITE_TOOLS.has(name);
}

function verificationTool(invocation: ToolInvocation): boolean {
  if (VERIFY_TOOLS.has(invocation.toolCall.name)) return true;
  if (invocation.toolCall.name !== "run_shell") return false;
  const command = String(invocation.toolCall.arguments.command ?? "");
  return /\b(test|typecheck|lint|vitest|jest|pytest|cargo test|go test|build)\b/iu.test(command);
}

function invocationSucceeded(invocation: ToolInvocation): boolean {
  if (invocation.error) return false;
  const exitCode = invocation.meta?.exitCode;
  return typeof exitCode !== "number" || exitCode === 0;
}

function invocationErrorCategory(invocation: ToolInvocation): ToolErrorCategory | undefined {
  if (invocationSucceeded(invocation)) return undefined;
  const structured = invocation.meta?.error;
  if (isRecord(structured) && isToolErrorCategory(structured.category)) return structured.category;
  const output = `${invocation.error ?? ""} ${invocation.output}`.toLowerCase();
  if (output.includes("circuit-open") || output.includes("circuit open")) return "CircuitOpen";
  if (output.includes("timeout")) return "Timeout";
  if (output.includes("blocked by") && output.includes("hook")) return "BlockedByHook";
  if (output.includes("not found") || output.includes("cannot read")) return "NotFound";
  if (output.includes("invalid") || output.includes("hunk context")) return "InvalidArguments";
  if (invocation.error) return "Unknown";
  return undefined;
}

function isToolErrorCategory(value: unknown): value is ToolErrorCategory {
  return typeof value === "string" && [
    "Unknown",
    "InvalidArguments",
    "UnexpectedEnvironment",
    "ProviderError",
    "UserAborted",
    "Timeout",
    "PermissionDenied",
    "NotFound",
    "CircuitOpen",
    "BlockedByHook",
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}
