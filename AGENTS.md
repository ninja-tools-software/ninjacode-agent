# NinjaCode Agent — Agent Instructions

NinjaCode Agent is the open-source (GPL-2.0-only) side of NinjaCode: the agent harness plus its VS Code extension, CLI and ACP server. This file is the canonical instruction set for AI coding agents working on this repo. Cursor-specific rules live in `.cursor/rules/`; workflow skills in `.cursor/skills/`.

## Repository layout

- `packages/core` — the agent harness: loop (`agent.ts`), permissions, context compaction, checkpoints (shadow git), rules/skills/hooks loading, MCP, subagents, sessions.
- `packages/tools` — built-in tools (`fs.ts`, `search.ts`, `shell.ts`, `patch.ts`, ...) and `ToolRegistry`. The shell tool is named `run_shell` (docs sometimes wrongly say `shell`).
- `packages/providers` — LLM adapters (Anthropic, OpenAI-compatible family, gateway, mock/echo), model catalog, gateway registry.
- `apps/cli`, `apps/vscode`, `apps/acp-agent`, `apps/bench` (NinjaBench).
  - `apps/vscode/src/protocol.ts` is the **only** contract between the extension host and the webview (discriminated `HostToWebview` / `WebviewToHost` unions). Add a message there first, then to `src/chat/messageRouter.ts` handlers and the webview's `useHostMessages`.
  - `apps/vscode/src/chat/*` — host controllers (context, refs, drops, sessions, plan, runner). `ChatViewProvider` only wires them together; keep new logic in a controller.
  - `apps/vscode/webview/src/chat/*` — `composer/` (contenteditable + document model), `dnd/`, `state/` (reducer + controllers), `log/`, `panels/`, `menus/`, `hooks/`. `App.tsx` is composition only.
  - `apps/vscode/webview/src/styles.css` is an import index only; the rules live in `styles/*.css`, imported in cascade order (later files may override earlier ones).
- `.ninjacode/` — per-workspace **runtime** data of the product (sessions, checkpoints, scratchpad). Gitignored; never edit by hand, never confuse `.ninjacode/rules/` (product runtime) with `.cursor/rules/` (this repo's dev rules).

The NinjaCode gateway (Hono + Drizzle + Postgres + Stripe) lives in a **separate private repository**, `ninjacode-backend`. It is proprietary: never copy code from it into this repo, since GPL-2.0 redistribution would not be possible. This repo talks to it only over HTTP, through the `gateway` provider in `packages/providers`.

## Commands

```bash
pnpm install                 # pnpm 9.15.9, Node >= 24
pnpm build                   # turbo run build (build before test/typecheck: they depend on ^build)
pnpm test                    # vitest across all packages
pnpm --filter @ninjacode/core test          # single package
pnpm typecheck               # blocking in CI
pnpm lint                    # ESLint flat config (eslint.config.mjs): clean-code budgets
pnpm knip                    # unused files, exports, dependencies
pnpm depcruise               # dependency direction, cycles, orphans
pnpm bench                   # NinjaBench (mock); live runs need ANTHROPIC_API_KEY
pnpm eval                    # CLI eval harness
pnpm --filter ninjacode package   # VSIX; build is pure and does not bump versions
pnpm version:bump                # explicit release-only patch bump
```

`pnpm build` and `package` are pure: they must not rewrite `package.json`. Bump versions only with `pnpm version:bump`, then commit and tag `vX.Y.Z`. CI runs `check:build-purity` and `check:clean-tree` after build and tests.

Known pitfall: docs can drift from the code (tool names, keybindings, provider lists).
Trust the code. Feature inventory: [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md).
Harness guarantees and limits: [docs/HARNESS.md](docs/HARNESS.md).

## Conventions

- TypeScript 5.8, `strict: true`, `noUnusedLocals`/`noUnusedParameters`, module `NodeNext` ESM: relative imports **must** use the `.js` extension (`import { x } from "./types.js"`).
- Internal deps use `workspace:*`.
- Clean-code budgets (function <= 60 lines, file <= 400, <= 4 params, nesting <= 3) are enforced by `pnpm lint`; dependency direction by `pnpm depcruise`.
- **The product has not shipped: there is no backward compatibility to preserve.** A refactor renames, moves and deletes in the same change — no compatibility re-exports, no deprecated aliases, no dual routes/settings, no migration shims left "in advance", no dead code kept "for later". See `.cursor/rules/no-legacy.mdc`. `pnpm knip` enforces unused exports.
- Tests are colocated Vitest files: `src/foo.ts` → `src/foo.test.ts`. Any change to the harness, permissions or tools requires a test.
- Errors are typed: tools throw `ToolError` with a code (`invalid_args`, `not_found`, `permission`, `timeout`, `aborted`, `runtime`); providers throw `LlmError(message, status, provider)`. Retry logic keys off these (429/5xx retryable) — never throw bare strings.
- Guardrails are deterministic, not prompt-only: safety lives in `PermissionEngine` (risk classes: `read_only`, `write`, `destructive`, `network`, `shell`, `user`), hooks, and the circuit breaker — not in system-prompt wording.
- **i18n**: user-facing UI strings go through each app's translation system; add keys in **en** and **fr** in the same change. See `.cursor/rules/i18n.mdc`. Model-facing prompts are out of scope.
- **Licensing**: everything here is GPL-2.0-only. Do not add third-party code under a GPL-incompatible licence (notably Apache-2.0 source you did not author), and set `"license": "GPL-2.0-only"` on any new workspace package.

## Harness invariants (do not break)

- **Prompt-cache stable prefix**: system prompt and tool specs must stay byte-stable within a session. No timestamps, UUIDs, or per-turn dynamic values in the system prompt or tool descriptions; volatile context goes into messages.
- **Compaction is progressive**: lossless first (truncate tool outputs, soften superseded reads in `context.ts`), LLM summarization last resort. Never delete tool messages in a way that breaks `tool_calls` chains. The summarizer is a model call like any other: its input must fit its own context window, and a fallback to the local heuristic must state its cause rather than pass for a successful compaction.
- Every retry loop needs a termination condition (max attempts, circuit breaker, abort signal). Every new loop in the agent needs a budget/turn check. **Waiting counts as a loop**: `llmTurnGuard.ts` bounds one LLM request and ends the run after consecutive stalls, because the circuit breaker only ever covered tools.
- **Risk classification is fail-closed.** `Tool.riskFor` reads arguments the model wrote, so it can be made to throw; an unclassifiable call is `destructive`, never the tool's static risk.
