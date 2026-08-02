import type { Completion, StreamSink, TokenUsage, ToolCall } from "./types.js";
import { parseSseJson, parseToolArguments, sseDataLines } from "./sse.js";

interface AnthropicStreamEvent {
  type: string;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface AnthropicStreamState {
  text: string;
  toolCalls: ToolCall[];
  currentTool: { id: string; name: string; inputJson: string } | null;
  usage: TokenUsage;
  stopReason: Completion["stopReason"];
}

function createAnthropicStreamState(): AnthropicStreamState {
  return {
    text: "",
    toolCalls: [],
    currentTool: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: "end",
  };
}

async function handleContentBlockStart(
  state: AnthropicStreamState,
  event: AnthropicStreamEvent,
  sink?: StreamSink,
): Promise<void> {
  if (event.content_block?.type !== "tool_use") return;
  state.currentTool = {
    id: event.content_block.id ?? `tool_${state.toolCalls.length}`,
    name: event.content_block.name ?? "",
    inputJson: "",
  };
  await sink?.({ type: "tool_call_start", id: state.currentTool.id, name: state.currentTool.name });
}

async function handleContentBlockDelta(
  state: AnthropicStreamState,
  event: AnthropicStreamEvent,
  sink?: StreamSink,
): Promise<void> {
  if (event.delta?.type === "text_delta" && event.delta.text) {
    state.text += event.delta.text;
    await sink?.({ type: "text_delta", text: event.delta.text });
    return;
  }
  if (event.delta?.type !== "input_json_delta" || !event.delta.partial_json || !state.currentTool) {
    return;
  }
  state.currentTool.inputJson += event.delta.partial_json;
  await sink?.({
    type: "tool_call_delta",
    id: state.currentTool.id,
    argumentsDelta: event.delta.partial_json,
  });
}

async function handleContentBlockStop(state: AnthropicStreamState, sink?: StreamSink): Promise<void> {
  if (!state.currentTool) return;
  const args = parseToolArguments(state.currentTool.inputJson);
  state.toolCalls.push({ id: state.currentTool.id, name: state.currentTool.name, arguments: args });
  await sink?.({ type: "tool_call_end", id: state.currentTool.id });
  state.currentTool = null;
}

async function handleMessageDelta(state: AnthropicStreamState, event: AnthropicStreamEvent): Promise<void> {
  if (event.usage) {
    state.usage = { ...state.usage, outputTokens: event.usage.output_tokens ?? state.usage.outputTokens };
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
      await handleMessageDelta(state, event);
      break;
    case "message_start":
      await handleMessageStart(state, event, sink);
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
  };
  await sink?.({ type: "done", completion });
  return completion;
}
