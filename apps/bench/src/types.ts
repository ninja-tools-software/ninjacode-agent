/** One scripted MockProvider turn (see packages/providers MockScript). */
export interface BenchMockScript {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

/** A single benchmark task, loaded from tasks/<id>/task.json. */
export interface BenchTask {
  id: string;
  /** Short human description shown in reports. */
  description: string;
  /** Category used to aggregate results (edit, fix, feature, refactor, explore, terminal). */
  category: "edit" | "fix" | "feature" | "refactor" | "explore" | "terminal";
  /** Difficulty hint, used only for reporting. */
  difficulty: "easy" | "medium" | "hard";
  /**
   * Optional suite tags (e.g. `"quick"`). Used by `--suite` to select a
   * subset for fast iteration loops; omitted tasks are full-suite only.
   */
  suites?: string[];
  /** Prompt sent to the agent under test. */
  prompt: string;
  /**
   * Shell command run inside the workspace after the agent finishes.
   * Exit code 0 = task solved. This is the single source of truth for correctness.
   */
  verify: string;
  /** Max wall-clock time for the agent, in seconds (default 300). */
  timeoutSec?: number;
  /** Per-task agent turn budget (overrides adapter default). */
  maxTurns?: number;
  /**
   * Force edit-tool filtering for scripted mock runs.
   * `"patch"` exposes `apply_patch` (hides `edit_file`); `"string_replace"` is the mock default.
   */
  editFormat?: "patch" | "string_replace";
  /**
   * When set, the task passes if the run ends with this failure kind
   * (e.g. harness-max-turns expects a clean agent_error).
   */
  expectFailureKind?: "agent_error" | "timeout";
  /** Require at least this many tool errors (e.g. error-recovery scenarios). */
  minToolErrors?: number;
  /**
   * Scripted MockProvider turns loaded from tasks/<id>/scripts.json.
   * Used when provider is mock — exercises the real harness without a LLM.
   */
  scripts?: BenchMockScript[];
  /** Absolute path to scripts.json when present (set by loadTasks). */
  scriptsFile?: string;
  /** Absolute path to the fixture directory copied into the temp workspace. */
  fixtureDir?: string;
}

/** What the harness measures for one (agent, task, trial) triple. */
export interface TaskMetrics {
  wallTimeMs: number;
  /** Token/cost metrics are only available for the in-process NinjaCode adapter. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  /** Number of assistant turns (in-process only). */
  turns?: number;
  /** Number of tool calls and how many errored (in-process only). */
  toolCalls?: number;
  toolErrors?: number;
  /** Calls per tool name — shows whether turns went to exploring or to editing. */
  toolHistogram?: Record<string, number>;
  /** Diff stats computed with git against the pristine fixture. */
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface TaskResult {
  taskId: string;
  agentName: string;
  trial: number;
  passed: boolean;
  /** Why it failed: verify command failed, agent errored, or timed out. */
  failureKind?: "verify" | "agent_error" | "timeout";
  errorMessage?: string;
  metrics: TaskMetrics;
  /** Raw agent output (final answer or CLI stdout tail), for debugging. */
  outputTail: string;
}

/** An adapter knows how to run one agent on a prepared workspace. */
export interface AgentAdapter {
  name: string;
  /** Runs the agent on the task inside `workspaceDir`, returns partial metrics. */
  run(
    task: BenchTask,
    workspaceDir: string,
    timeoutMs: number,
  ): Promise<{
    metrics: Partial<TaskMetrics>;
    outputTail: string;
    agentError?: string;
    timedOut?: boolean;
  }>;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  gitCommit?: string;
  agents: string[];
  results: TaskResult[];
}
