---
name: add-llm-provider
description: Add a new LLM provider adapter or model to packages/providers, covering streaming, error mapping, prompt caching, catalog and gateway registry entries, and tests. Use when integrating a new LLM API, provider, or model into NinjaCode.
---

# Add an LLM Provider

## Decide the path first

- **New model on an existing API** → only Step 4 (catalog/gateway) + tests.
- **OpenAI-compatible API** (most vendors) → add a factory in `openai-compatible.ts` (see `createDeepSeekProvider`, `createGlmProvider`: baseUrl + default model). No new adapter class.
- **Genuinely new wire format** → full adapter implementing `LlmProvider`.

## Checklist (full adapter)

```
- [ ] Step 1: Adapter implementing complete + completeStreaming
- [ ] Step 2: Error mapping and retry semantics
- [ ] Step 3: Prompt caching
- [ ] Step 4: Catalog + gateway registry + factory wiring
- [ ] Step 5: Tests
```

## Step 1: Adapter

Implement `LlmProvider` from `packages/providers/src/types.ts`. Non-negotiables:

- `completeStreaming` parses SSE incrementally and emits ordered `StreamEvent`s: `text_delta`/`reasoning_delta`/`tool_call_*` → `usage` → exactly one `done` carrying the final `Completion`. Tool-call arguments arrive as string deltas; accumulate and JSON-parse at `tool_call_end`.
- `Completion.stopReason` must distinguish `tool_use` from `end` — the agent loop branches on it.
- `usage` must include `cacheReadTokens`/`cacheWriteTokens` when the API reports them (budget tracking and cache-health monitoring depend on it).
- Pass `req.signal` to `fetch` **and** check it in the stream-read loop.
- Map `Message[]` faithfully: system extraction, `toolCalls` on assistant messages, `toolCallId`+`name` on `role: "tool"` messages, image `parts` if the API supports vision.

## Step 2: Errors

Non-2xx → `throw new LlmError(bodyText, res.status, this.name)`. Core's `withRetry` retries 429/5xx/network only; masking the status breaks it. Never retry inside the adapter (retry is layered on top and would compound). Mid-stream failure: emit `{ type: "error" }` then throw.

## Step 3: Prompt caching

When `req.cacheSystemPrompt` is true:
- Anthropic-style APIs: `cache_control: { type: "ephemeral" }` breakpoints (last tool def, system block, last message block; max 4). Mirror `anthropic.ts`.
- OpenAI-style APIs: automatic prefix caching — keep serialization byte-stable (stable tool ordering, no dynamic values before history) and set `prompt_cache_key` (see `openai-compatible.ts`).

## Step 4: Wiring

1. `catalog.ts`: model entries with context window, pricing, reasoning support, vision. The catalog describes models only.
2. `packages/core/src/harnessProfiles.ts`: edit format, verification policy, orchestration profile, default reasoning effort. This is the **only** place the harness reads them from; add a family entry, and a model entry only when it differs from its family.
3. `gatewayRegistry.ts`: entry if the model is served through the NinjaCode gateway (route template + price table).
4. `types.ts`: extend `ProviderKind`; `index.ts`: wire into `createProvider` (keep the exhaustive `never` check) and export.
5. Hosts: check `apps/cli` and `apps/vscode` provider pickers expose the new kind.

## Step 5: Tests

Colocated `*.test.ts` (see `openai-compatible.test.ts`, `providers.test.ts`):
- tool-call assembly from streamed argument deltas,
- `LlmError` status mapping on 429/500,
- usage extraction including cache tokens,
- abort mid-stream.

Run `pnpm build && pnpm --filter @ninjacode/providers test`, then a live smoke via `pnpm eval` if you have a key, and `pnpm bench` for behavior regressions (see the `harness-eval` skill).
