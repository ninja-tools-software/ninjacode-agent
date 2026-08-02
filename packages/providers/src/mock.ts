import type { Completion, CompletionRequest, LlmProvider, StreamSink, ToolCall } from "./types.js";
import { emptyUsage } from "./types.js";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException(signal.reason ? String(signal.reason) : "Aborted", "AbortError");
  }
}

export interface MockScript {
  /** Text response, or tool calls to emit. */
  text?: string;
  toolCalls?: ToolCall[];
  stopReason?: Completion["stopReason"];
}

/**
 * Deterministic mock provider for tests and offline demos.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";
  private scripts: MockScript[];
  private index = 0;

  constructor(scripts: MockScript[] = [{ text: "Mock response." }]) {
    this.scripts = scripts;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(req: CompletionRequest, sink?: StreamSink): Promise<Completion> {
    throwIfAborted(req.signal);
    const script = this.scripts[Math.min(this.index, this.scripts.length - 1)] ?? { text: "done" };
    this.index += 1;

    const text = script.text ?? "";
    if (text) {
      for (const chunk of text.match(/.{1,12}/g) ?? []) {
        throwIfAborted(req.signal);
        await sink?.({ type: "text_delta", text: chunk });
      }
    }

    const toolCalls = script.toolCalls ?? [];
    for (const tc of toolCalls) {
      throwIfAborted(req.signal);
      await sink?.({ type: "tool_call_start", id: tc.id, name: tc.name });
      await sink?.({
        type: "tool_call_delta",
        id: tc.id,
        argumentsDelta: JSON.stringify(tc.arguments),
      });
      await sink?.({ type: "tool_call_end", id: tc.id });
    }

    const completion: Completion = {
      text,
      toolCalls,
      usage: {
        ...emptyUsage(),
        inputTokens: 10,
        outputTokens: Math.max(1, Math.ceil(text.length / 4)),
      },
      model: "mock",
      stopReason: script.stopReason ?? (toolCalls.length ? "tool_use" : "end"),
    };
    await sink?.({ type: "done", completion });
    return completion;
  }
}

/**
 * Echo provider — returns the last user message. Useful for smoke tests.
 */
export class EchoProvider implements LlmProvider {
  readonly name = "echo";

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(req: CompletionRequest, sink?: StreamSink): Promise<Completion> {
    throwIfAborted(req.signal);
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const text = `Echo: ${lastUser?.content ?? ""}`;
    await sink?.({ type: "text_delta", text });
    const completion: Completion = {
      text,
      toolCalls: [],
      usage: emptyUsage(),
      model: "echo",
      stopReason: "end",
    };
    await sink?.({ type: "done", completion });
    return completion;
  }
}
