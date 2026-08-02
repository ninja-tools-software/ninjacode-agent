# Contributing to NinjaCode

## Development setup

```bash
# Requires Node 20+
npx pnpm install
npx pnpm build
npx pnpm test
```

### Run the CLI (mock, offline)

```bash
npx pnpm --filter @ninjacode/cli exec node dist/index.js demo
```

### Run with your API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx pnpm --filter @ninjacode/cli exec node dist/index.js run "Add a README section" --yes
```

### VS Code extension

1. `npx pnpm --filter ninjacode build`
2. Open `apps/vscode` in VS Code / Cursor and press F5 (Extension Development Host),
   or package with `npx pnpm --filter ninjacode package`.

### ACP agent (JetBrains / Zed)

```bash
npx pnpm --filter @ninjacode/acp-agent build
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

The gateway backend lives in a separate, private repository; nothing here
depends on it at build time.

## CLA

All contributors must agree to [CLA.md](CLA.md) on their first PR.

## Code style

- TypeScript strict mode
- No unused locals
- Prefer small PRs with tests for harness / permissions / tool logic
