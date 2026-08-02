export { Agent, createSubAgent } from "./agent.js";
export type { AgentOptions, AgentTaskInput } from "./agent.js";

export { buildAgentRuntime } from "./runtime.js";
export type { AgentRuntime, BuildAgentRuntimeOptions } from "./runtime.js";
export type { AgentFactory, SubAgentSpawnOptions } from "./agentFactory.js";

export {
  PermissionEngine,
  defaultPermissionPolicy,
} from "./permissions.js";
export type { ApprovalMode, PermissionDecision, PermissionPolicy } from "./permissions.js";

export { CheckpointManager } from "./checkpoints.js";
export type { Checkpoint, ChangedFileStat } from "./checkpoints.js";

export {
  compactHistory,
  compactHistorySync,
  compactHistoryLossless,
  truncateToolOutput,
  toolOutputLimit,
  softenSupersededReads,
  estimateContextUsage,
} from "./context.js";
export type { CompactionInfo, ContextUsageBreakdown } from "./context.js";
export { estimateTokens } from "./contextEstimate.js";

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
  createDelegateTool,
  modelForSubAgentRole,
  ROLE_MODEL_TIER,
} from "./subagents.js";
export type { SubAgentRole, SubAgentResult, SubAgentModelTier } from "./subagents.js";

export { filterToolsForEditFormat, preferredEditFormat } from "./editTools.js";
export type { EditFormat } from "./editTools.js";

export { classifyToolFailure } from "./toolErrors.js";
export type { ToolErrorCategory, ClassifiedToolError } from "./toolErrors.js";

export { loadVerifyConfig, runVerification } from "./verify.js";
export type { VerifyConfig, VerificationResult, RunVerificationOptions } from "./verify.js";

export {
  McpClient,
} from "./mcpClient.js";
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
  TurnTrace,
  AgentEvent,
  AgentEventHandler,
  ApprovalRequest,
  ApprovalHandler,
  AgentOutcome,
  SessionState,
} from "./types.js";
