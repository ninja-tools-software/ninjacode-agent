/**
 * Shared LLM types and provider interface for NinjaCode.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export type ProviderKind =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "openrouter"
  | "moonshot"
  | "glm"
  | "mistral"
  | "xai"
  | "mammouth"
  | "openai-compatible"
  | "local"
  | "gateway"
  | "mock"
  | "echo";

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Multimodal content parts. `content` on `Message` remains the canonical
 * plain-text body (kept for backward compatibility with every existing
 * caller that treats it as a string); `parts` is an additive list of extra
 * content — currently just images — that vision-capable providers attach
 * alongside that text.
 */
export type ContentPart = {
  type: "image";
  /** e.g. "image/png", "image/jpeg", "image/webp", "image/gif". */
  mimeType: string;
  /** Base64-encoded image bytes (no "data:" prefix). */
  data: string;
};

export interface Message {
  role: Role;
  content: string;
  /** Optional multimodal parts (images) attached to this message. */
  parts?: ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  /** Signed thinking blocks to replay on an assistant turn. */
  reasoningBlocks?: ReasoningBlock[];
}

export function hasImageParts(message: Message): boolean {
  return Boolean(message.parts?.some((p) => p.type === "image"));
}

/**
 * A provider-signed reasoning block. Anthropic verifies the signature when the
 * block comes back, so it has to round-trip verbatim: the harness keeps these on
 * the assistant message and the adapter replays them ahead of any other content.
 * Losing them means paying for extended thinking and discarding it every turn.
 */
export type ReasoningBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export interface CompletionRequest {
  messages: Message[];
  tools?: ToolSpec[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Stable system/tool prefix for prompt caching when supported. */
  cacheSystemPrompt?: boolean;
  /** OpenAI-style reasoning effort (o-series / OpenRouter). */
  reasoningEffort?: ReasoningEffort;
  /** Anthropic extended thinking budget in tokens. */
  thinkingBudgetTokens?: number;
  /** Force a tool call on the last delivery attempt. Tools/order stay unchanged. */
  toolChoice?: "auto" | "required" | "none";
  /** Abort signal for cancelling the request (fetch + stream consumption). */
  signal?: AbortSignal;
}

export interface Completion {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  model: string;
  /** Model actually used after gateway Auto routing (when different from request). */
  resolvedModel?: string;
  stopReason: "end" | "tool_use" | "max_tokens" | "error";
  /** Reasoning/thinking text when the provider exposes it (OpenAI o-series, etc.). */
  reasoning?: string;
  /** Signed reasoning blocks that must be replayed on the next turn (Anthropic). */
  reasoningBlocks?: ReasoningBlock[];
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string }
  | {
      type: "routing";
      model: string;
      label?: string;
      reason?: string;
      tier?: string;
      estimatedCredits?: number;
    }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; completion: Completion }
  | { type: "error"; error: string };

export type StreamSink = (event: StreamEvent) => void | Promise<void>;

export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<Completion>;
  completeStreaming(req: CompletionRequest, sink?: StreamSink): Promise<Completion>;
  /**
   * Optional provider-native context compaction. Implementations must preserve
   * the same structured-summary contract as `complete`; core always retains
   * its portable local compactor as the fallback.
   */
  compactContext?(req: CompletionRequest): Promise<Completion>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly provider?: string,
    /** Server-requested wait before retrying, parsed from `Retry-After`. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

export function wantsTools(completion: Completion): boolean {
  return completion.toolCalls.length > 0;
}
