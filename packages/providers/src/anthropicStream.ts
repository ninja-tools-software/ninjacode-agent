import type { Completion, ReasoningBlock, StreamSink, TokenUsage, ToolCall } from "./types.js";
import { LlmError } from "./types.js";
import { anthropicErrorStatus } from "./anthropicErrors.js";
import { parseSseJson, parseToolArguments, sseDataLines } from "./sse.js";

interface AnthropicStreamEvent {
  type: string;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    thinking?: string;
    signature?: string;
    data?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: { type?: string; message?: string };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

/**
 * Blocks arrive one at a time and are only complete at `content_block_stop`, so
 * deltas accumulate here until then.
 */
type OpenBlock =
  | { kind: "tool"; id: string; name: string; inputJson: string }
  | { kind: "thinking"; thinking: string; signature: string };

interface AnthropicStreamState {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  reasoningBlocks: ReasoningBlock[];
  open: OpenBlock | null;
  usage: TokenUsage;
  stopReason: Completion["stopReason"];
}

function createAnthropicStreamState(): AnthropicStreamState {
  return {
    text: "",
    reasoning: "",
    toolCalls: [],
    reasoningBlocks: [],
    open: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: "end",
  };
}

async function handleContentBlockStart(
  state: AnthropicStreamState,
  event: AnthropicStreamEvent,
  sink?: StreamSink,
): Promise<void> {
  const block = event.content_block;
  if (block?.type === "tool_use") {
    const id = block.id ?? `tool_${state.toolCalls.length}`;
    state.open = { kind: "tool", id, name: block.name ?? "", inputJson: "" };
    await sink?.({ type: "tool_call_start", id, name: block.name ?? "" });
    return;
  }
  if (block?.type === "thinking") {
    state.open = { kind: "thinking", thinking: block.thinking ?? "", signature: block.signature ?? "" };
    return;
  }
  // Redacted thinking is delivered complete and opaque; it only has to round-trip.
  if (block?.type === "redacted_thinking" && block.data) {
    state.reasoningBlocks.push({ type: "redacted_thinking", data: block.data });
  }
}

async function handleThinkingDelta(
  state: AnthropicStreamState,
  delta: NonNullable<AnthropicStreamEvent["delta"]>,
  sink?: StreamSink,
): Promise<void> {
  if (state.open?.kind !== "thinking") return;
  if (delta.type === "signature_delta" && delta.signature) {
    state.open.signature += delta.signature;
    return;
  }
  if (delta.type !== "thinking_delta" || !delta.thinking) return;
  state.open.thinking += delta.thinking;
  state.reasoning += delta.thinking;
  await sink?.({ type: "reasoning_delta", text: delta.thinking });
}

async function handleToolInputDelta(
  state: AnthropicStreamState,
  delta: NonNullable<AnthropicStreamEvent["delta"]>,
  sink?: StreamSink,
): Promise<void> {
  if (state.open?.kind !== "tool" || !delta.partial_json) return;
  state.open.inputJson += delta.partial_json;
  await sink?.({
    type: "tool_call_delta",
    id: state.open.id,
    argumentsDelta: delta.partial_json,
  });
}

async function handleContentBlockDelta(
  state: AnthropicStreamState,
  event: AnthropicStreamEvent,
  sink?: StreamSink,
): Promise<void> {
  const delta = event.delta;
  if (!delta) return;
  switch (delta.type) {
    case "text_delta":
      if (!delta.text) return;
      state.text += delta.text;
      await sink?.({ type: "text_delta", text: delta.text });
      return;
    case "thinking_delta":
    case "signature_delta":
      await handleThinkingDelta(state, delta, sink);
      return;
    case "input_json_delta":
      await handleToolInputDelta(state, delta, sink);
      return;
    default:
      return;
  }
}

async function handleContentBlockStop(
  state: AnthropicStreamState,
  sink?: StreamSink,
): Promise<void> {
  const open = state.open;
  if (!open) return;
  state.open = null;
  if (open.kind === "thinking") {
    // An unsigned block would be rejected on replay, so it is kept for display
    // through `reasoning` but never sent back.
    if (open.signature) {
      state.reasoningBlocks.push({
        type: "thinking",
        thinking: open.thinking,
        signature: open.signature,
      });
    }
    return;
  }
  state.toolCalls.push({
    id: open.id,
    name: open.name,
    arguments: parseToolArguments(open.inputJson),
  });
  await sink?.({ type: "tool_call_end", id: open.id });
}

function handleMessageDelta(state: AnthropicStreamState, event: AnthropicStreamEvent): void {
  if (event.usage) {
    state.usage = {
      ...state.usage,
      outputTokens: event.usage.output_tokens ?? state.usage.outputTokens,
    };
  }
  if (event.delta?.stop_reason === "tool_use") state.stopReason = "tool_use";
  if (event.delta?.stop_reason === "max_tokens") state.stopReason = "max_tokens";
}

async function handleMessageStart(
  state: AnthropicStreamState,
  event: AnthropicStreamEvent,
  sink?: StreamSink,
): Promise<void> {
  if (!event.message?.usage) return;
  state.usage = {
    inputTokens: event.message.usage.input_tokens ?? 0,
    outputTokens: event.message.usage.output_tokens ?? 0,
    cacheReadTokens: event.message.usage.cache_read_input_tokens,
    cacheWriteTokens: event.message.usage.cache_creation_input_tokens,
  };
  await sink?.({ type: "usage", usage: state.usage });
}

/**
 * A stream can fail after HTTP 200. The typed error carries the retryability, so
 * it is mapped to a status rather than surfaced as a bare message.
 */
async function failFromStreamError(
  event: AnthropicStreamEvent,
  sink?: StreamSink,
): Promise<never> {
  const detail = event.error?.message ?? event.error?.type ?? "unknown stream error";
  await sink?.({ type: "error", error: detail });
  throw new LlmError(
    `anthropic stream error${event.error?.type ? ` (${event.error.type})` : ""}: ${detail}`,
    anthropicErrorStatus(event.error?.type),
    "anthropic",
  );
}

async function applyAnthropicStreamEvent(
  state: AnthropicStreamState,
  event: AnthropicStreamEvent,
  sink?: StreamSink,
): Promise<void> {
  switch (event.type) {
    case "content_block_start":
      await handleContentBlockStart(state, event, sink);
      break;
    case "content_block_delta":
      await handleContentBlockDelta(state, event, sink);
      break;
    case "content_block_stop":
      await handleContentBlockStop(state, sink);
      break;
    case "message_delta":
      handleMessageDelta(state, event);
      break;
    case "message_start":
      await handleMessageStart(state, event, sink);
      break;
    case "error":
      await failFromStreamError(event, sink);
      break;
    default:
      break;
  }
}

export async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  model: string,
  sink?: StreamSink,
): Promise<Completion> {
  const state = createAnthropicStreamState();

  for await (const data of sseDataLines(body)) {
    const event = parseSseJson<AnthropicStreamEvent>(data);
    if (!event) continue;
    await applyAnthropicStreamEvent(state, event, sink);
  }

  if (state.toolCalls.length) state.stopReason = "tool_use";
  const completion: Completion = {
    text: state.text,
    toolCalls: state.toolCalls,
    usage: state.usage,
    model,
    stopReason: state.stopReason,
    reasoning: state.reasoning || undefined,
    reasoningBlocks: state.reasoningBlocks.length ? state.reasoningBlocks : undefined,
  };
  await sink?.({ type: "done", completion });
  return completion;
}
