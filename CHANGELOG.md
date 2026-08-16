# Changelog

All notable changes to NinjaCode Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Require Node.js 24. `undici` 8 needs `markAsUncloneable`, which Node 20 does not provide.

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
