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
  | "mammouth"
  | "openai-compatible"
  | "local"
  | "gateway"
  | "mock"
  | "echo";

export type ReasoningEffort = "low" | "medium" | "high";

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
}

export function hasImageParts(message: Message): boolean {
  return Boolean(message.parts?.some((p) => p.type === "image"));
}

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
  /** Reasoning/thinking tokens when the provider exposes them (OpenAI o-series, etc.). */
  reasoning?: string;
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
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly provider?: string,
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
