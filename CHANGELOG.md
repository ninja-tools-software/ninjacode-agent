# Changelog

All notable changes to NinjaCode Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Time bounds on a single LLM turn (`llmTurnGuard`): a per-request ceiling narrowed by the
  remaining run budget, a stream-idle watchdog, and termination after consecutive stalls. A
  provider that stops answering used to be able to spend a whole run's wall-clock budget
  waiting, since the circuit breaker only ever covered tools.
- Anthropic extended thinking is now streamed to the UI and replayed, signed, on the next
  turn. It was being paid for and discarded every turn.
- `Retry-After` is honored when the server sends it (capped at 60 s), and Anthropic error
  bodies are typed so `overloaded_error` is retryable while `invalid_request_error` is final.
- Attached images count toward the context estimate instead of being treated as free.

### Changed

- Require Node.js 24. `undici` 8 needs `markAsUncloneable`, which Node 20 does not provide.
- The summarizer's input transcript is bounded by its own model's context window, dropping the
  oldest messages and never the prior checkpoint. Falling back to the local heuristic now
  states its cause instead of passing for a successful compaction.
- Edit format has a single source of truth in `harnessProfiles.ts`. The model catalog declared
  it on 19 models that nothing read.
- The Harbor bundle manifest records `gitTreeDirty`. A bundle built from a modified tree is no
  longer `publishable` and `harbor audit` rejects it: a score produced by code that is not in
  git history cannot be reproduced or attributed.

### Fixed

- An unclassifiable tool call is treated as `destructive` instead of falling back to the tool's
  static risk. Combined with a host that pre-approved every tool (CLI `--yes`, bench, cloud
  worker), a shell command whose risk classifier threw could previously run unattended.
- A retry is no longer suppressed by bookkeeping events. Anthropic reports usage at
  `message_start`, which marked the turn as having produced visible output and blocked every
  safe retry on that provider.

### Removed

- `compactHistorySync`, a second compaction implementation with absolute thresholds that
  ignored the model's context window, and with no production caller.
- The `optionalTools` profile mechanism: no profile ever removed the git tools, so the filter
  was an identity.

## [0.2.0] - 2026-08-02

### Added

- Composer rewritten as a rich editor: context references are inline badges you can type
  around, drag, reorder and remove.
- Universal drag & drop into the chat — Explorer files and folders, editor tabs, Source
  Control entries, OS files, images and links — dropped at the caret.
- Native **Add to Chat** menus in the Explorer, the editor tab and selection, Source Control,
  the Problems view and the terminal, plus the `Ctrl+Alt+A` shortcut.
- Badge hover preview with token cost, and attached context folded into the context-window
  meter.
- Composer drafts persisted per session across webview reloads.

### Fixed

- Checkpoints no longer fail when git commit signing is enabled globally: the shadow repo
  commits with signing turned off instead of prompting for, or failing on, a signing key.
- A hook that does not read its standard input no longer crashes the agent with an uncaught
  `EPIPE`.

## [0.1.0]

### Added

- Initial release: agent chat, diff review, checkpoints, MCP, multi-provider BYOK.
- Debug mode: hypothesis-driven instrumentation, local NDJSON log server, cleanup of
  `NINJACODE-DEBUG` markers.

[Unreleased]: https://github.com/ninja-tools-software/ninjacode-agent/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ninja-tools-software/ninjacode-agent/releases/tag/v0.2.0
