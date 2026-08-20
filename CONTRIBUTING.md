# Contributing to NinjaCode

Read [AGENTS.md](AGENTS.md) for conventions, harness invariants, and clean-code budgets.
All contributors must agree to [CLA.md](CLA.md) on their first pull request.

**There is no backward compatibility to preserve.** The product has not shipped: rename,
move, or delete internal APIs in the same change. Do not leave dual paths, deprecated
aliases, or migration shims “just in case”.

## Development setup

```bash
# Requires Node 24+
pnpm install
pnpm build
pnpm test
```

Quality gates (also run in CI):

```bash
pnpm lint        # clean-code budgets (size/complexity currently warn)
pnpm knip        # unused files, exports, dependencies
pnpm depcruise   # dependency direction, cycles, orphans
pnpm typecheck
```

### Run the CLI (mock, offline)

```bash
pnpm --filter @ninjacode/cli exec node dist/index.js demo
```

### Run with your API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm --filter @ninjacode/cli exec node dist/index.js run "Add a README section" --yes
```

### VS Code extension

1. `pnpm --filter ninjacode build`
2. Open `apps/vscode` in VS Code / Cursor and press F5 (Extension Development Host),
   or package with `pnpm --filter ninjacode package`.

### ACP agent (JetBrains / Zed)

```bash
pnpm --filter @ninjacode/acp-agent build
# Point the IDE ACP config at: node /path/to/apps/acp-agent/dist/index.js
```

See [apps/acp-agent/acp-manifest.json](apps/acp-agent/acp-manifest.json) for registry submission.

## Project layout

Everything in this repository is GPL-2.0-only.

| Path | Role |
|------|------|
| `packages/core` | Agent harness |
| `packages/providers` | LLM adapters |
| `packages/tools` | Built-in tools |
| `apps/cli` | Headless CLI |
| `apps/vscode` | VS Code extension |
| `apps/acp-agent` | ACP JSON-RPC server |
| `apps/bench` | NinjaBench benchmark harness |
| `apps/cloud-worker` | Experimental durable-job foundation (not a hosted product) |

The gateway backend lives in a separate, private repository; nothing here
depends on it at build time.

## Code style

- TypeScript strict mode, ESM `NodeNext` (relative imports need the `.js` extension)
- No unused locals
- Prefer small PRs with tests for harness / permissions / tool logic
- User-facing UI strings: add keys in **en** and **fr** in the same change (see
  `.cursor/rules/i18n.mdc`)
