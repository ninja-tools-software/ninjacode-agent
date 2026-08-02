/** Types shared by the chat view and the Settings editor tab. */

import type { SettingsPayload, WireModelInfo } from "../../src/protocol.js";

/** Wire settings snapshot — derived from the host protocol, not redeclared. */
export type SettingsState = SettingsPayload;

export type Mode = SettingsPayload["mode"];
export type ApprovalMode = SettingsPayload["approvalMode"];
export type ModelInfo = WireModelInfo;

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
  "gateway",
  "mock",
] as const;

/** Plans mirrored from GATEWAY_PLANS (packages/providers) for the upsell cards. */
export const CREDIT_PLANS: Array<{
  id: string;
  label: string;
  price: string;
  credits: string;
  hint?: string;
}> = [
  { id: "starter", label: "Starter", price: "$20", credits: "2,000 credits/mo" },
  { id: "pro", label: "Pro", price: "$50", credits: "6,000 credits/mo", hint: "3x usage" },
  { id: "ultra", label: "Ultra", price: "$150", credits: "24,000 credits/mo", hint: "12x usage" },
];

export function formatContextWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
