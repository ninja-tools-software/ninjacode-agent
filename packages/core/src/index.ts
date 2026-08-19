export { Agent, createSubAgent } from "./agent.js";
export type {
  AgentOptions,
  AgentTaskInput,
  IndependentVerifierOptions,
  PerformanceOptions,
  ResolvedIndependentVerifierOptions,
  ResolvedPerformanceOptions,
  SubAgentGovernanceOptions,
  VerificationMode,
} from "./agent.js";

export { buildAgentRuntime } from "./runtime.js";
export type { AgentRuntime, BuildAgentRuntimeOptions } from "./runtime.js";
export type { AgentFactory, SubAgentSpawnOptions } from "./agentFactory.js";

export {
  PermissionEngine,
  defaultPermissionPolicy,
} from "./permissions.js";
export type { ApprovalMode, PermissionCall, PermissionDecision, PermissionPolicy } from "./permissions.js";
export type { ContextViewOptions } from "./contextViewBuilder.js";
export type { PutArtifactOptions } from "./sessionArtifacts.js";
export {
  DEFAULT_RUN_TIMEOUT_MS,
  resolveIndependentVerifierOptions,
  resolvePerformanceOptions,
} from "./agentOptions.js";
export {
  configureTelemetry,
  createTelemetryContext,
  currentTelemetryContext,
  extractTelemetryContext,
  flushTelemetry,
  injectTelemetryHeaders,
  redactTelemetryAttributes,
  runWithTelemetryContext,
  shutdownTelemetry,
  startSpan,
} from "./telemetry.js";
export type {
  CreateTelemetryContextOptions,
  StartSpanOptions,
  TelemetryAttributes,
  TelemetryAttributeValue,
  TelemetryContext,
  TelemetryExporter,
  TelemetryRecord,
  TelemetryRedactor,
  TelemetryScope,
  TelemetrySpan,
} from "./telemetry.js";
export { OtlpHttpExporter, toOtlpPayload } from "./otlpHttpExporter.js";
export type {
  OtlpFetch,
  OtlpFetchResponse,
  OtlpHttpExporterOptions,
} from "./otlpHttpExporter.js";
export {
  attachTrajectoryOutcome,
  compareTrajectories,
  createTrajectory,
  createTrajectoryEvent,
  deserializeTrajectory,
  persistTrajectory,
  replayTrajectory,
  serializeTrajectory,
  TrajectoryRecorder,
  TRAJECTORY_SCHEMA_VERSION,
} from "./trajectory.js";
export {
  persistRedactedEventsJsonl,
  persistToolTimeline,
  siblingArtifactPath,
  summarizeToolArgs,
  ToolTimelineRecorder,
  TOOL_TIMELINE_SCHEMA_VERSION,
} from "./toolTimeline.js";
export type {
  ToolTimeline,
  ToolTimelineEntry,
  ToolTimelineTurn,
} from "./toolTimeline.js";
export type {
  Trajectory,
  TrajectoryCaptureOptions,
  TrajectoryComparison,
  TrajectoryEvent,
  TrajectoryEventType,
  TrajectoryOutcome,
  TrajectoryReplay,
} from "./trajectory.js";
export {
  configureLearningMetrics,
  flushLearningMetrics,
  recordLearningFeedback,
} from "./learningMetrics.js";
export type {
  LearningDecision,
  LearningFeedback,
  LearningFeedbackInput,
  LearningMetricsSink,
} from "./learningMetrics.js";
export {
  createOAuthAuthPort,
  createDeviceOAuthHost,
  createMemorySecretStore,
  deviceCodeGrant,
} from "./mcpOAuth.js";
export type { McpOAuthGrant, McpOAuthHost, SecretStore } from "./mcpOAuth.js";

export { CheckpointManager } from "./checkpoints.js";
export type { Checkpoint, ChangedFileStat } from "./checkpoints.js";

export {
  compactHistory,
  compactHistorySync,
  compactHistoryLossless,
  truncateToolOutput,
  toolOutputLimit,
  softenSupersededReads,
} from "./context.js";
export type { CompactionInfo } from "./context.js";
export {
  clampMaxTokens,
  contextSafetyMargin,
  estimateTokens,
  estimateContextUsage,
} from "./contextEstimate.js";
export type { ContextUsageBreakdown } from "./contextEstimate.js";

export {
  buildSystemPrompt,
  loadProjectRules,
  discoverRules,
  normalizeRulePath,
  readRuleBody,
  writeRule,
  deleteRule,
  RULES_WRITE_DIR,
} from "./rules.js";
export type { RuleDiagnostic, RuleDiscoveryResult, RuleSourceKind, RuleInput } from "./rules.js";

export {
  assetConfigPath,
  loadAssetConfig,
  isAssetEnabled,
  setAssetEnabled,
} from "./assetRegistry.js";
export type { AssetKind, WorkspaceAssetConfig } from "./assetRegistry.js";

export {
  runSubAgent,
  runSubAgents,
  createDelegateTool,
  modelForSubAgentRole,
  ROLE_MODEL_TIER,
  DEFAULT_SUBAGENT_GOVERNANCE,
  resolveSubAgentGovernance,
  SubAgentOrchestrator,
} from "./subagents.js";
export type {
  ResolvedSubAgentGovernance,
  RunSubAgentOptions,
  SubAgentArtifact,
  SubAgentEvidence,
  SubAgentModelTier,
  SubAgentResult,
  SubAgentRole,
  SubAgentTestResult,
} from "./subagents.js";

export { filterToolsForEditFormat, preferredEditFormat } from "./editTools.js";
export type { EditFormat } from "./editTools.js";
export {
  filterToolsForHarnessProfile,
  resolveHarnessProfile,
} from "./harnessProfiles.js";
export type {
  HarnessProfile,
  HarnessProfileVersion,
  ResolveHarnessProfileInput,
  VerificationPolicy,
} from "./harnessProfiles.js";

export {
  collectIndependentVerifierEvidence,
  INDEPENDENT_VERIFIER_SCHEMA_VERSION,
  parseIndependentVerifierVerdict,
  runVerificationSubAgent,
} from "./agentSupport.js";
export type {
  IndependentVerifierEvidence,
  IndependentVerifierIssue,
  IndependentVerifierRunResult,
  IndependentVerifierVerdict,
} from "./agentSupport.js";

export {
  classifyTaskComplexity,
  createPhasePolicyState,
  DEFAULT_ADAPTIVE_ORCHESTRATION,
  enterVerificationPhase,
  explorationBudgetFor,
  observePhaseTurn,
  recordVerificationFailure,
  resolveAdaptiveOrchestrationOptions,
} from "./phasePolicy.js";
export type {
  AdaptiveDelegationDecision,
  AdaptiveDelegationRole,
  AdaptiveOrchestrationOptions,
  AgentPhase,
  OrchestrationProfile,
  PhasePolicyState,
  PhaseTransition,
  ResolvedAdaptiveOrchestrationOptions,
  TaskComplexity,
} from "./phasePolicy.js";

export { classifyToolFailure } from "./toolErrors.js";
export type { ToolErrorCategory, ClassifiedToolError } from "./toolErrors.js";

export { loadVerifyConfig, runVerification } from "./verify.js";
export type {
  VerifyConfig,
  VerificationCommandResult,
  VerificationResult,
  RunVerificationOptions,
} from "./verify.js";

export { scaffoldVerifyConfig } from "./verifyInfer.js";
export type { ScaffoldVerifyResult } from "./verifyInfer.js";

export {
  McpClient,
} from "./mcpClient.js";
export type {
  McpAuthPort,
  McpExecutionOptions,
  McpToolDefinition,
} from "./mcpClient.js";
export { McpCatalog } from "./mcpCatalog.js";
export {
  expandEnvRefs,
  loadMcpConfig,
  loadMcpConfigFile,
  MCP_CONFIG_REL,
  removeMcpServer,
  setMcpServerEnabled,
  upsertMcpServer,
  validateMcpServer,
  writeMcpConfig,
} from "./mcpConfig.js";
export type { McpConfigFile, McpServerConfig } from "./mcpConfig.js";
export { loadMcpTools, loadMcpToolsWithStatus } from "./mcp.js";
export type { McpServerStatus } from "./mcp.js";
export { SessionArtifactStore } from "./sessionArtifacts.js";
export { SessionEventLog, sessionEventLog } from "./sessionEventLog.js";
export type { SessionEvent, SessionEventType } from "./sessionEventLog.js";

export { loadPrompts, expandPromptArguments } from "./prompts.js";
export type { PromptDefinition, PromptScope } from "./prompts.js";

export {
  loadCustomAgents,
  createCustomAgentHandoffTools,
  enabledCustomAgents,
  writeCustomAgent,
  deleteCustomAgent,
  AGENTS_WRITE_DIR,
} from "./customAgents.js";
export type { CustomAgentDefinition, CustomAgentInput } from "./customAgents.js";

export {
  discoverSkills,
  loadSkillBody,
  createUseSkillTool,
  enabledSkills,
  writeSkill,
  deleteSkill,
  SKILLS_WRITE_DIR,
} from "./skills.js";
export type { SkillDefinition, SkillContext, SkillInput } from "./skills.js";

export { loadHooksConfig, HookRunner } from "./hooks.js";
export type {
  HookEvent,
  HookDefinition,
  HooksFile,
  HookRunResult,
  HookExecInput,
  HookApprovalHandler,
} from "./hooks.js";

export { AgentLogChannel, redact, truncateForLog } from "./agentLogs.js";
export type { AgentLogEntry, AgentLogEventType } from "./agentLogs.js";

export {
  saveSession,
  loadSession,
  loadSessionSafe,
  listSessions,
  deleteSession,
  buildPersistedSession,
  deriveSessionTitle,
  userMessageIndices,
  checkpointIdForUserMessageOrdinal,
  appendSessionNote,
  truncateHistoryAtMessageIndex,
  truncateHistoryAtUserMessageOrdinal,
  forkHistoryAtUserMessageOrdinal,
  truncateSessionAtUserMessageOrdinal,
  forkSession,
  renameSession,
  setSessionFlags,
  exportSessionAsJson,
  exportSessionAsMarkdown,
} from "./sessions.js";
export type { PersistedSession, SessionSummary } from "./sessions.js";

export { normalizeToolHistory, alignCompactionStart, isValidToolChain } from "./toolHistory.js";

export {
  withRetry,
  ToolCircuitBreaker,
  BudgetTracker,
} from "./reliability.js";
export type { RetryOptions, SessionBudget } from "./reliability.js";

export {
  DebugLogServer,
  DebugSession,
  readDebugLogs,
  summarizeByHypothesis,
  debugLogPath,
  hypothesesPath,
} from "./debug.js";
export type { Hypothesis, HypothesisStatus, DebugLogEntry } from "./debug.js";

export type { Clock, FileSystem, ProcessRunner, ProcessRunOptions, ProcessRunResult } from "./ports.js";
export { nodeClock, nodeFileSystem, nodeProcessRunner } from "./nodePorts.js";

export {
  planIdForSession,
  readPlan,
  listPlans,
  writePlan,
  deletePlan,
  renamePlanTitle,
  stripPlanHeader,
  stripTasksMarkers,
  planContentForDisplay,
} from "@ninjacode/tools";
export type { PlanRecord, PlanSummary } from "@ninjacode/tools";

export type {
  AgentMode,
  RunState,
  StateChangePayload,
  SessionConfig,
  RequestCheckpoint,
  ToolInvocation,
  ToolStartEventPayload,
  ToolEndEventPayload,
  CheckpointFailure,
  TurnTrace,
  AgentEvent,
  AgentEventHandler,
  ApprovalRequest,
  ApprovalHandler,
  AgentOutcome,
  AgentStopReason,
  SessionState,
} from "./types.js";
