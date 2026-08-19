import type {
  Completion,
  CompletionRequest,
  LlmProvider,
  Message,
  StreamSink,
  ToolSpec,
} from "./types.js";
import { parseGatewayError } from "./gatewayErrors.js";
import { parseRetryAfterMs } from "./retryAfter.js";
import { LlmError } from "./types.js";
import { consumeOpenAIStream } from "./openaiStream.js";
import { llmFetchInit } from "./llmTransport.js";
import { promptCacheKey } from "./promptCache.js";

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  name?: string;
  /** Extra headers (e.g. OpenRouter HTTP-Referer). */
  headers?: Record<string, string>;
}

/**
 * OpenAI-compatible chat completions provider.
 * Works with OpenAI, DeepSeek, OpenRouter, Ollama, LM Studio, vLLM, etc.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly headers: Record<string, string>;

  constructor(config: OpenAICompatibleConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = config.model ?? "gpt-4o";
    this.name = config.name ?? "openai-compatible";
    this.headers = config.headers ?? {};
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(req: CompletionRequest, sink?: StreamSink): Promise<Completion> {
    const model = req.model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      messages: toOpenAIMessages(req.messages),
      max_tokens: req.maxTokens ?? 8192,
      temperature: req.temperature ?? 0.2,
      stream: true,
      stream_options: { include_usage: true },
      ...(req.tools?.length
        ? {
            tools: req.tools.map(toOpenAITool),
            tool_choice: req.toolChoice ?? "auto",
          }
        : {}),
    };

    if (req.reasoningEffort) {
      // OpenAI o-series, xAI Grok, and OpenRouter reasoning models.
      body.reasoning_effort = req.reasoningEffort;
      if (this.name === "openrouter" || this.name === "ninjacode-gateway" || this.name === "xai") {
        body.reasoning = { effort: req.reasoningEffort };
      }
    }

    if (req.cacheSystemPrompt && (this.name === "openai" || this.name === "ninjacode-gateway")) {
      // Prefix-cache routing stickiness for upstreams with automatic caching
      // (OpenAI, DeepSeek, ...). Harmless for upstreams that ignore the field.
      body.prompt_cache_key = promptCacheKey(model, req);
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, llmFetchInit({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.headers,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    }));

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      const gatewayErr = parseGatewayError(errText, {
        status: res.status,
        provider: this.name,
      });
      if (gatewayErr) throw gatewayErr;
      throw new LlmError(
        `${this.name} error ${res.status}: ${errText}`,
        res.status,
        this.name,
        parseRetryAfterMs(res.headers.get("retry-after")),
      );
    }

    if (!res.body) {
      throw new LlmError(`${this.name}: empty response body`, undefined, this.name);
    }

    return consumeOpenAIStream(res.body, model, sink);
  }
}

export function createOpenAIProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    model: model ?? "gpt-4o",
    name: "openai",
  });
}

export function createDeepSeekProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://api.deepseek.com/v1",
    model: model ?? "deepseek-v4-flash",
    name: "deepseek",
  });
}

export function createOpenRouterProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://openrouter.ai/api/v1",
    model: model ?? "anthropic/claude-sonnet-4",
    name: "openrouter",
    headers: {
      "HTTP-Referer": "https://ninja-code.ai",
      "X-Title": "NinjaCode",
    },
  });
}

export function createMoonshotProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://api.moonshot.ai/v1",
    model: model ?? "kimi-k2-0711-preview",
    name: "moonshot",
  });
}

export function createGlmProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: model ?? "glm-4.5",
    name: "glm",
  });
}

export function createMistralProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://api.mistral.ai/v1",
    model: model ?? "mistral-large-latest",
    name: "mistral",
  });
}

export function createXaiProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://api.x.ai/v1",
    model: model ?? "grok-4.6",
    name: "xai",
  });
}

export function createMammouthProvider(apiKey: string, model?: string): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://api.mammouth.ai/v1",
    model: model ?? "mammouth-recommended",
    name: "mammouth",
  });
}

function toOpenAITool(tool: ToolSpec) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toOpenAIMessages(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content,
      };
    }
    const images = m.parts?.filter((p) => p.type === "image") ?? [];
    if (images.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const img of images) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        });
      }
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content };
  });
}
