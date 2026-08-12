/** Types shared by the chat view and the Settings editor tab. */

import type {
  GatewayPlanPayload,
  PlanKind,
  SettingsPayload,
  WireModelInfo,
} from "../../src/protocol.js";

/** Wire settings snapshot — derived from the host protocol, not redeclared. */
export type SettingsState = SettingsPayload;
export type { GatewayPlanPayload, PlanKind };

export type Mode = SettingsPayload["mode"];
export type ApprovalMode = SettingsPayload["approvalMode"];
export type ModelInfo = WireModelInfo;
export type ModelSortId = SettingsPayload["modelSort"];

export interface VsCodeApi {
  postMessage: (msg: unknown) => void;
}

export interface SkillItem {
  name: string;
  description: string;
  context: "inline" | "fork";
  allowedTools?: string[];
  /** Base directory it was discovered in, e.g. `.ninjacode/skills`. */
  source: string;
  enabled: boolean;
  /** Workspace-relative SKILL.md path. */
  path: string;
}

export interface CustomAgentItem {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  systemPrompt: string;
  source: string;
  enabled: boolean;
  /** Workspace-relative file path. */
  path: string;
}

export interface RuleItem {
  kind: string;
  /** Workspace-relative path, also the id used to toggle it. */
  path: string;
  included: boolean;
  reason?: string;
  globs?: string[];
  chars?: number;
  enabled: boolean;
}

export interface McpServerConfigItem {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  transport?: "stdio" | "http";
  enabled?: boolean;
}

export interface McpServerStatusItem {
  name: string;
  transport: string;
  status: "connected" | "error" | "disabled";
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
  error?: string;
  config?: McpServerConfigItem;
}

export interface AgentLogEntryItem {
  timestamp: string;
  sessionId: string;
  type: string;
  summary: string;
  detail?: string;
}

/** Bring-your-own-key providers shown in Settings. NinjaCode Pass is not a row here. */
export const ALL_PROVIDERS = [
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "moonshot",
  "glm",
  "mistral",
  "mammouth",
  "openai-compatible",
  "local",
  "mock",
] as const;

export function formatContextWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
