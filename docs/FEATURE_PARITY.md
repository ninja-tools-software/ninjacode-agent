# Feature parity — NinjaCode vs Cursor / Copilot

Verified against public docs (VS Code Copilot + Cursor help/docs) as of July 2026.
NinjaCode keeps its **webview chat as the primary UI** and adds stable VS Code Extension APIs for editor surfaces.

**Out of scope (by design):** cloud/background agents, PR automation bots, privileged integrated-browser control, Copilot Agents Window, proprietary NES routing APIs.

| Area | Cursor / Copilot | NinjaCode | Notes |
|------|------------------|-----------|-------|
| Stop / cancel | Stop, queue, steer, stop-and-send | **Delivered** | `AbortSignal` end-to-end; Stop button + Esc + `ninjacode.stopAgent` |
| Session concurrency | Parallel local sessions | **Delivered** | `SessionRuntimeManager` per session |
| Modes Ask / Plan / Agent / Debug | Yes | **Delivered** | Tool registry + system prompts |
| Model picker + reasoning | Yes | **Delivered** | Catalog + effort/budget when supported |
| Context meter + compact | Yes | **Delivered** | Gauge + `/compact` + breakdown events |
| Conversation history | List, fork, archive, export | **Delivered** | Pin/archive/rename/export/fork/edit-resend |
| Checkpoints | Per-request restore/redo | **Delivered** | Shadow-git; request-level; redo stack |
| Proposed edits review | Keep/Undo, Changes panel | **Delivered** | Per-file + hunk accept/reject; persist; sensitive-file gate |
| Mentions / attachments | `#`/`@`, images | **Delivered** | Inline badges in the composer; `@`, `+` picker, native "Add to Chat" menus, drag & drop at the caret, paste image (vision models) |
| Codebase search | Semantic + lexical | **Partial** | Local lexical index + `search_codebase`; optional embeddings stub |
| Rules / instructions | AGENTS, .cursor, .github | **Delivered** | Nested AGENTS, `.mdc`, copilot-instructions |
| Prompts / skills / custom agents | `.prompt.md`, SKILL.md, `.agent.md` | **Delivered** | Loaders + slash menu + handoffs/hooks |
| MCP | Tools/resources/prompts UI | **Partial** | Client + settings status; resources listed when available |
| Terminal tool | Sandbox + streaming | **Partial** | Controlled subprocess; abortable; not VS Code terminal UX |
| Inline edit | Cmd/Ctrl+K / Ctrl+I | **Delivered** | `ninjacode.inlineEdit` (Ctrl/Cmd+I) |
| Inline completions | Ghost text | **Delivered** | `InlineCompletionItemProvider` |
| Next edit suggestions | Native NES | **Partial** | Heuristic decorations + Tab when visible (no proprietary API) |
| Code actions / review | Explain, fix, PR review | **Delivered** | Code actions + `ninjacode.reviewChanges` diagnostics |
| Native Chat participant | Built-in | **Delivered** | `@ninjacode` when `vscode.chat` exists |
| BYOK in model picker | Copilot BYOK | **Delivered** | `languageModelChatProviders` when `vscode.lm` exists |
| Cloud agents / Agents Window | Yes | **Out of scope** | Requires remote workers |
| Voice dictation | Yes | **Delivered** | Local whisper.cpp; assets from `ninja-tools-software/ninjacode-voice` releases; see below |

## Voice dictation notes (macOS)

- Assets (whisper-server binary + ggml model) are downloaded on first use from the `voice-manifest.json` of the [ninjacode-voice](https://github.com/ninja-tools-software/ninjacode-voice) release pointed to by `ninjacode.voice.manifestUrl` (blank = built-in default).
- **Capture runs in the extension host, not the webview.** VS Code / Cursor webviews are sandboxed iframes with no `microphone` Permissions-Policy, so `getUserMedia()` is always rejected there (`NotAllowedError` / "microphone is not allowed in this document") regardless of the OS permission — see microsoft/vscode#250568, #113916. The host therefore spawns a native recorder that streams raw 16 kHz mono PCM on stdout (`apps/vscode/src/voice/recorder.ts`).
- **Requires a native recorder on `PATH`:** `sox` (preferred, `brew install sox`) or `ffmpeg`. Override the command with `ninjacode.voice.recorderCommand` (must output raw s16le mono 16 kHz on stdout).
- Microphone access is still governed by the **editor process** at the OS level. On macOS, grant it in System Settings > Privacy & Security > Microphone for "Visual Studio Code" (or the host you run, e.g. Cursor); the spawned recorder inherits that entitlement.
- Extension Development Host: when VS Code is launched from a terminal, macOS may attribute the mic permission to the terminal app. If access is silently denied, reset it with `tccutil reset Microphone com.microsoft.VSCode` and retry.

## Public API limits

- Copilot’s Changes panel, native checkpoints, and NES engine are **not** exposed to third-party extensions — NinjaCode reimplements equivalents.
- Chat participant history is limited to turns involving that participant; NinjaCode sessions remain authoritative in the webview.
- Reasoning effort chosen in the native Copilot picker is not always passed to extension participants; NinjaCode’s own picker controls effort for the webview agent.
- `InlineCompletionItemProvider` supports ghost text; multi-file “jump then edit” NES is approximated only.

## Sources

- [Copilot feature matrix](https://docs.github.com/en/copilot/reference/copilot-feature-matrix)
- [Chat / interrupt](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode)
- [Context](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context)
- [Sessions](https://code.visualstudio.com/docs/copilot/chat/chat-sessions)
- [Inline chat](https://code.visualstudio.com/docs/copilot/chat/inline-chat)
- [Suggestions / NES](https://code.visualstudio.com/docs/copilot/ai-powered-suggestions)
- Cursor docs: Agent, Rules, MCP, Tab (docs.cursor.com)
