import { parseGatewayError } from "./gatewayErrors.js";
import type { Completion, StreamSink, TokenUsage, ToolCall } from "./types.js";
import { LlmError } from "./types.js";
import { parseSseJson, parseToolArguments, sseDataLines } from "./sse.js";

interface OpenAIChunk {
  object?: string;
  model?: string;
  label?: string;
  reason?: string;
  tier?: string;
  estimatedCredits?: number;
  choices?: Array<{
    finish_reason?: string;
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: string | { message?: string };
}

function mapFinishReason(reason?: string): Completion["stopReason"] {
  if (reason === "tool_calls" || reason === "tool_use") return "tool_use";
  if (reason === "length" || reason === "max_tokens") return "max_tokens";
  if (reason === "error") return "error";
  return "end";
}

function sseErrorMessage(error: OpenAIChunk["error"]): string {
  if (typeof error === "string") return error;
  return error?.message ?? JSON.stringify(error);
}

/**
 * OpenAI reports `prompt_tokens` inclusive of cached tokens, Anthropic reports
 * them as separate counters. `TokenUsage` uses the Anthropic convention —
 * disjoint buckets — so cost and cache-rate maths work the same for every
 * provider. Subtract the cached share here.
 */
function usageFromChunk(parsed: OpenAIChunk): TokenUsage | undefined {
  if (!parsed.usage) return undefined;
  const promptTokens = parsed.usage.prompt_tokens ?? 0;
  const cacheReadTokens = (parsed.usage as { prompt_tokens_details?: { cached_tokens?: number } })
    .prompt_tokens_details?.cached_tokens;
  return {
    inputTokens: Math.max(0, promptTokens - (cacheReadTokens ?? 0)),
    outputTokens: parsed.usage.completion_tokens ?? 0,
    cacheReadTokens,
  };
}

async function applyReasoningDelta(
  delta: string,
  reasoning: { text: string },
  sink?: StreamSink,
): Promise<void> {
  reasoning.text += delta;
  await sink?.({ type: "reasoning_delta", text: delta });
}

async function applyTextDelta(delta: string, text: { value: string }, sink?: StreamSink): Promise<void> {
  text.value += delta;
  await sink?.({ type: "text_delta", text: delta });
}

type OpenAIToolCallDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

async function mergeToolCallDelta(
  toolAcc: Map<number, { id: string; name: string; arguments: string }>,
  tc: OpenAIToolCallDelta,
  sink?: StreamSink,
): Promise<void> {
  const idx = tc.index ?? 0;
  let acc = toolAcc.get(idx);
  if (!acc) {
    acc = { id: tc.id ?? `call_${idx}`, name: tc.function?.name ?? "", arguments: "" };
    toolAcc.set(idx, acc);
    if (tc.function?.name) {
      await sink?.({ type: "tool_call_start", id: acc.id, name: acc.name });
    }
  }
  if (tc.id) acc.id = tc.id;
  if (tc.function?.name) acc.name = tc.function.name;
  if (!tc.function?.arguments) return;
  acc.arguments += tc.function.arguments;
  await sink?.({ type: "tool_call_delta", id: acc.id, argumentsDelta: tc.function.arguments });
}

function toolCallsFromAcc(
  toolAcc: Map<number, { id: string; name: string; arguments: string }>,
): ToolCall[] {
  return [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => ({
      id: v.id,
      name: v.name,
      arguments: parseToolArguments(v.arguments),
    }))
    .filter((tc) => tc.name.length > 0);
}

async function applyChoiceDelta(
  choice: NonNullable<OpenAIChunk["choices"]>[0],
  state: {
    text: { value: string };
    reasoning: { text: string };
    toolAcc: Map<number, { id: string; name: string; arguments: string }>;
    finishReason: Completion["stopReason"];
  },
  sink?: StreamSink,
): Promise<void> {
  if (choice.finish_reason) state.finishReason = mapFinishReason(choice.finish_reason);
  const delta = choice.delta;
  const reasoningDelta =
    delta?.reasoning_content ?? (typeof delta?.reasoning === "string" ? delta.reasoning : undefined);
  if (reasoningDelta) await applyReasoningDelta(reasoningDelta, state.reasoning, sink);
  if (delta?.content) await applyTextDelta(delta.content, state.text, sink);
  if (!delta?.tool_calls) return;
  for (const tc of delta.tool_calls) {
    await mergeToolCallDelta(state.toolAcc, tc, sink);
  }
}

async function processOpenAIChunk(
  data: string,
  model: string,
  state: {
    text: { value: string };
    reasoning: { text: string };
    toolAcc: Map<number, { id: string; name: string; arguments: string }>;
    usage: TokenUsage;
    finishReason: Completion["stopReason"];
    resolvedModel?: string;
  },
  sink?: StreamSink,
): Promise<void> {
  if (data === "[DONE]") return;
  const parsed = parseSseJson<OpenAIChunk>(data);
  if (!parsed) return;
  if (parsed.error) {
    const raw = sseErrorMessage(parsed.error);
    const partial = state.text.value.length > 0 || state.reasoning.text.length > 0;
    throw (
      parseGatewayError(raw, { provider: model, partial }) ?? new LlmError(raw, undefined, model)
    );
  }

  if (parsed.object === "ninjacode.routing" && typeof parsed.model === "string") {
    state.resolvedModel = parsed.model;
    await sink?.({
      type: "routing",
      model: parsed.model,
      label: parsed.label,
      reason: parsed.reason,
      tier: parsed.tier,
      estimatedCredits: parsed.estimatedCredits,
    });
    return;
  }

  const usage = usageFromChunk(parsed);
  if (usage) {
    state.usage = usage;
    await sink?.({ type: "usage", usage });
  }

  const choice = parsed.choices?.[0];
  if (choice) await applyChoiceDelta(choice, state, sink);
}

export async function consumeOpenAIStream(
  body: ReadableStream<Uint8Array>,
  model: string,
  sink?: StreamSink,
): Promise<Completion> {
  const state = {
    text: { value: "" },
    reasoning: { text: "" },
    toolAcc: new Map<number, { id: string; name: string; arguments: string }>(),
    usage: { inputTokens: 0, outputTokens: 0 } as TokenUsage,
    finishReason: "end" as Completion["stopReason"],
    resolvedModel: undefined as string | undefined,
  };

  for await (const data of sseDataLines(body)) {
    await processOpenAIChunk(data, model, state, sink);
  }

  const toolCalls = toolCallsFromAcc(state.toolAcc);
  for (const tc of toolCalls) {
    await sink?.({ type: "tool_call_end", id: tc.id });
  }

  let finishReason = state.finishReason;
  if (toolCalls.length > 0 && finishReason !== "max_tokens") finishReason = "tool_use";

  const completion: Completion = {
    text: state.text.value || (state.reasoning.text ? "" : state.text.value),
    toolCalls,
    usage: state.usage,
    model,
    resolvedModel: state.resolvedModel,
    stopReason: finishReason,
    reasoning: state.reasoning.text || undefined,
  };
  await sink?.({ type: "done", completion });
  return completion;
}
