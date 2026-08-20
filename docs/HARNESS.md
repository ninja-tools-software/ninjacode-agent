# Harness limits

What the NinjaCode agent harness guarantees today, and what it deliberately does not.
Feature inventory lives in [FEATURE_PARITY.md](FEATURE_PARITY.md); dated engineering
notes live in [AUDIT_HARNESS_2026-08.md](AUDIT_HARNESS_2026-08.md).

## Guarantees

- **Prompt-cache stable prefix.** System prompt and tool specs stay byte-stable within a
  session. Volatile context (scratchpad, plan, IDE state) goes into messages.
- **Progressive compaction.** Truncate tool outputs, soften superseded reads, mask
  re-runnable observations, then LLM summarization as last resort. Tool-call chains stay
  valid for OpenAI-style APIs.
- **Deterministic permissions.** Risk classes (`read_only` / `write` / `destructive` /
  `network` / `shell` / `user`) are enforced in `PermissionEngine`, not by prompt wording.
  `destructive` always needs approval. Risk classification is fail-closed: an unclassifiable
  call is treated as `destructive`.
- **Bounded loops.** Turn budget, cost ceiling, abort signal, tool-call loop detection,
  circuit breaker on tools, and per-LLM-turn timeouts (`llmTurnGuard`) with stream-idle
  watchdog.
- **Shadow-git checkpoints.** One checkpoint per user request before edits; restore/redo
  from the UI.

## Known limits

- **Tokenizer.** Token estimates are `chars/4` calibrated on reported usage — fine for
  conservative gates, imprecise on dense code.
- **No prompt-injection defense.** Untrusted content (files, `fetch_url`, MCP) is not
  marked. Defense rests on permissions and the sandbox.
- **Sandbox read confinement.** Seatbelt/Bubblewrap confine writes but still allow reading
  the host outside masked paths. `run_shell` validates `cwd` only; it is not path-confined.
- **`web_search`.** Scrapes DuckDuckGo HTML with a regex parser — fragile by design; no
  paid search API.
- **Missing vs market.** No background shell with `kill_shell`, no multi-location edit in
  one call, no image-read tool.
- **Verification knobs.** `verificationMode` and `enableVerificationSubAgent` both exist;
  prefer `verificationMode`. The boolean is a host override, not a second policy.
- **Public score.** No publishable Terminal-Bench score from a clean-tree bundle yet. See
  [BENCHMARKS.md](BENCHMARKS.md).

## Orchestration profiles

`standard` (default for most models) keeps the classic turn loop. `adaptive` (default for
xAI/Grok) adds phase policy: exploration budget, automatic read-only delegation, verify/
recover transitions. Both share the same tools and permissions.
