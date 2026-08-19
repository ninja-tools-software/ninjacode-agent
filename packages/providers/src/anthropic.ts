import type {
  Completion,
  CompletionRequest,
  LlmProvider,
  Message,
  StreamSink,
  ToolSpec,
} from "./types.js";
import { LlmError } from "./types.js";
import { applyAnthropicCacheBreakpoints } from "./anthropicCache.js";
import { anthropicHttpError } from "./anthropicErrors.js";
import { consumeAnthropicStream } from "./anthropicStream.js";

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Anthropic Messages API provider with streaming and tool use.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly baseUrl: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.model ?? "claude-sonnet-4-20250514";
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(req: CompletionRequest, sink?: StreamSink): Promise<Completion> {
    const model = req.model ?? this.defaultModel;
    const { system, messages } = splitSystem(req.messages);

    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 8192,
      temperature: req.temperature ?? 0.2,
      messages: toAnthropicMessages(messages),
      stream: true,
    };

    if (system) body.system = system;

    if (req.tools?.length) {
      body.tools = req.tools.map(toAnthropicTool);
    }

    if (req.thinkingBudgetTokens && req.thinkingBudgetTokens > 0) {
      body.thinking = {
        type: "enabled",
        budget_tokens: req.thinkingBudgetTokens,
      };
      // Anthropic requires temperature 1 when thinking is enabled
      body.temperature = 1;
    }

    // Place cache breakpoints on the stable prefix (system, last tool, last message).
    if (req.cacheSystemPrompt) {
      applyAnthropicCacheBreakpoints(body);
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        ...(req.cacheSystemPrompt ? { "anthropic-beta": "prompt-caching-2024-07-31" } : {}),
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw anthropicHttpError({
        status: res.status,
        body: errText,
        retryAfter: res.headers.get("retry-after"),
      });
    }
    if (!res.body) {
      throw new LlmError("anthropic: empty response body", undefined, this.name);
    }

    return consumeAnthropicStream(res.body, model, sink);
  }
}

function splitSystem(messages: Message[]): { system: string; messages: Message[] } {
  const systemParts: string[] = [];
  const rest: Message[] = [];
  for (const m of messages) {
    if (m.role === "system") systemParts.push(m.content);
    else rest.push(m);
  }
  return { system: systemParts.join("\n\n"), messages: rest };
}

function toAnthropicTool(tool: ToolSpec) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function toAnthropicImageBlocks(m: Message): Array<Record<string, unknown>> {
  const images = m.parts?.filter((p) => p.type === "image") ?? [];
  return images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mimeType, data: img.data },
  }));
}

/**
 * Thinking blocks must come first in an assistant turn and go back exactly as
 * they arrived — the signature is verified server-side.
 */
function toAnthropicThinkingBlocks(m: Message): Array<Record<string, unknown>> {
  return (m.reasoningBlocks ?? []).map((block) =>
    block.type === "thinking"
      ? { type: "thinking", thinking: block.thinking, signature: block.signature }
      : { type: "redacted_thinking", data: block.data },
  );
}

function toAnthropicMessages(messages: Message[]) {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = toAnthropicThinkingBlocks(m);
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    if (m.role === "tool") {
      // Anthropic expects tool results as user messages
      const last = out[out.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      if (last?.role === "user" && Array.isArray(last.content)) {
        (last.content as Array<Record<string, unknown>>).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const imageBlocks = toAnthropicImageBlocks(m);
    if (imageBlocks.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: "text", text: m.content });
      content.push(...imageBlocks);
      out.push({ role, content });
    } else if (!appendTextToPreviousUserMessage(out, role, m.content)) {
      out.push({ role, content: m.content });
    }
  }
  return out;
}

/**
 * Anthropic requires alternating roles, so two consecutive user messages have to
 * become one. This happens whenever volatile workspace state is injected: before
 * the task at the start of a run, or after tool results (themselves user-role
 * `tool_result` blocks) mid-run. Text blocks are appended, so they land after any
 * tool_result. Returns false when there is nothing to merge into.
 */
function appendTextToPreviousUserMessage(
  out: Array<Record<string, unknown>>,
  role: string,
  content: string,
): boolean {
  if (role !== "user" || !content) return false;
  const last = out[out.length - 1];
  if (last?.role !== "user") return false;
  if (typeof last.content === "string") {
    last.content = [{ type: "text", text: last.content }];
  }
  if (!Array.isArray(last.content)) return false;
  (last.content as Array<Record<string, unknown>>).push({ type: "text", text: content });
  return true;
}
