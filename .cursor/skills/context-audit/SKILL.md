---
name: context-audit
description: Audit token consumption and prompt-cache health of the NinjaCode agent. Use when token costs rise, cache read rates drop, context overflows too early, or when reviewing changes to the system prompt, tool specs, or compaction in packages/core.
---

# Context Audit

Token efficiency and KV-cache hit rate are the two performance levers of the harness. This skill walks through diagnosing both.

## 1. Cache-prefix stability check

The prefix (tool specs → system prompt → history) must be byte-identical across turns. One changed byte invalidates everything after it.

Hunt for prefix poison, in order of likelihood:
- Dynamic values in the system prompt: dates, times, session ids, token counters. Search `packages/core/src/prompts.ts` and everything concatenated into the system message in `agent.ts`.
- Tool set mutations mid-session: `ToolRegistry.forMode` / `filterToolsForEditFormat` must run once at session start; adding a tool later (e.g. MCP hot-add) invalidates the cache — acceptable only if deliberate.
- Non-deterministic tool spec serialization (Map iteration order, conditional fields).
- History rewriting: compaction rewrites history and inherently breaks cache once — verify it does not fire every turn (thrashing).

Verification: run a multi-turn session and read `cacheReadTokens`/`cacheWriteTokens` from `BudgetTracker.snapshot()` (or the bench report). Healthy pattern from turn 2 onward: cache reads ≈ previous input size, cache writes small. Cache reads at 0 with `cacheSystemPrompt` enabled = broken prefix.

## 2. Tool output budget check

- Core backstop truncates tool messages at 8k chars (`TOOL_OUTPUT_MAX` in `context.ts`), but by then tokens were already spent once. Tools should bound output at the source with limit/pagination params and a `[truncated]` marker telling the model how to get more.
- Look for the worst offenders in a real session file (`.ninjacode/sessions/*.json`): sort tool messages by content length. Frequent 8k `run_shell` or `grep` dumps mean the tool needs tighter defaults.

## 3. Compaction behavior check

Pipeline in `packages/core/src/context.ts` — verify order is preserved: lossless (truncate + `softenSupersededReads`) before LLM summarization; summarization only past soft/hard thresholds.

- Superseded `read_file`/`list_dir` results must be softened (body replaced), never deleted — deleting breaks `tool_calls` chains on OpenAI-style APIs.
- Pinned task and constraint messages (`extractPinnedMessages`) must survive summarization.
- Thrash test: if compaction triggers on consecutive turns, thresholds are too tight relative to the model's context window.

## 4. Known measurement caveat

`estimateTokens` is `chars / 4` — off by 2x on code-dense or non-English content. Treat all local thresholds as approximate; the provider-reported `TokenUsage` is ground truth. If a fix depends on accurate counts, compare estimate vs reported usage first.

## 5. Static-to-dynamic migration (state of the art)

When auditing, ask for each piece of always-injected context: could the agent fetch this on demand instead? Prefer writing large context (logs, docs, MCP tool catalogs) to files under `.ninjacode/` and letting the agent `read_file`/`grep` them — only names and one-line pointers stay static. This is the pattern that top harnesses (Cursor, Claude Code, Codex) converged on.

## Reporting

Conclude an audit with: cache read rate before/after, top 3 token consumers, and one actionable fix each. Validate any change with the `harness-eval` skill (A/B on NinjaBench).
