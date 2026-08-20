# NinjaCode Agent

**Open-source agentic coding** for VS Code — and JetBrains / Zed / Neovim via [ACP](https://zed.dev/acp).
Bring your own API key (Anthropic, OpenAI, DeepSeek, OpenRouter, Moonshot, GLM, Mistral,
xAI, Mammouth, any OpenAI-compatible endpoint), run a local model, or point the agent at a
NinjaCode gateway.

This repository contains everything that runs on the developer's machine: the agent harness,
the built-in tools, the provider adapters, and the three front-ends (VS Code extension, CLI,
ACP server). The hosted gateway that powers NinjaCode Pass is a separate, private project;
nothing here needs it to build or run.

## Why it exists

The model-tool loop is commodity. The differentiation is the **harness**:

- Cache-stable system prompts and progressive context compaction
- Deterministic permissions — risk classes enforced in code, not prompt wording
- Shadow-git checkpoints with one-click restore
- Modes: **Agent** / **Plan** / **Ask** / **Debug** (hypothesis-driven instrumentation)
- Sub-agents for context isolation
- MCP client, project rules (`AGENTS.md`, `.ninjacode/rules/`), skills and hooks
- Stop / queue / steer, context meter, rich attachments, inline edit and completions
- Voice dictation, and an interface localized in English and French
- One TypeScript core shared by every IDE integration

## Repository layout

```
apps/vscode        VS Code extension (host + React webview)
apps/cli           headless CLI (`ninjacode`)
apps/acp-agent     ACP JSON-RPC server for JetBrains / Zed / Neovim
apps/bench         NinjaBench — benchmark and monitoring harness
apps/cloud-worker  Experimental durable-job foundation (not a hosted cloud-agent product)

packages/core       agent loop, permissions, context compaction, checkpoints,
                    rules/skills/hooks, MCP, sub-agents, sessions
packages/tools      built-in tools (fs, search, run_shell, patch, ...) + ToolRegistry
packages/providers  LLM adapters, model catalog, gateway client
```

Dependency direction is one-way: apps depend on `core`, `core` depends on `tools` and
`providers`, and the leaves never reach back up. `pnpm depcruise` enforces it.

```
 apps/vscode   apps/cli   apps/acp-agent   apps/bench   apps/cloud-worker
        \          |            /            /              /
         \         |           /            /              /
                        packages/core
                              |
                 packages/tools + packages/providers
```

## Prerequisites

- **Node.js** >= 24
- **pnpm** 9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- **Git**
- VS Code >= 1.105 for the extension (or a compatible fork)
- A provider API key — or use the `mock` provider offline

## Install and build

```bash
git clone git@github.com:ninja-tools-software/ninjacode-agent.git
cd ninjacode-agent
pnpm install
pnpm build
```

Other root scripts: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`,
`pnpm knip`, `pnpm clean`.

## Run

### VS Code extension

```bash
pnpm --filter ninjacode package        # -> apps/vscode/ninjacode-<version>.vsix
code --install-extension apps/vscode/ninjacode-*.vsix
```

Then: **NinjaCode: Set API Key** to store your provider key in SecretStorage, and
**NinjaCode: Open Chat** (or the NinjaCode icon in the activity bar).

Key settings (`Preferences: Open Settings` -> search `ninjacode`):

| Setting | Values |
|---------|--------|
| `ninjacode.provider` | `gateway`, `anthropic`, `openai`, `deepseek`, `openrouter`, `moonshot`, `glm`, `mistral`, `xai`, `mammouth`, `openai-compatible`, `local`, `mock` |
| `ninjacode.model`, `ninjacode.baseUrl` | provider-specific |
| `ninjacode.localBaseUrl` | endpoint of the `local` provider (default `http://localhost:11434/v1`) |
| `ninjacode.mode` | `agent`, `plan`, `ask`, `debug` |
| `ninjacode.approvalMode` | `strict`, `balanced`, `autonomous` |
| `ninjacode.reviewEdits` | hold edits for diff review |
| `ninjacode.locale` | `auto`, `en`, `fr` |

Dev loop: `pnpm --filter ninjacode dev`, then open `apps/vscode` in VS Code and press F5
for the Extension Development Host.

### CLI

```bash
# Offline demo, no key needed
pnpm --filter @ninjacode/cli start -- demo

export ANTHROPIC_API_KEY=sk-ant-...
pnpm --filter @ninjacode/cli start -- run "Explain this repo" --mode ask
pnpm --filter @ninjacode/cli start -- run "Add a healthcheck endpoint" --mode agent

# After a build, call the binary directly
node apps/cli/dist/index.js run "..." --mode agent
```

Flags: `--provider`, `--model`, `--api-key`, `--base-url`, `--workspace`, `--mode`,
`--approval`, `--lang`, `--yes`, `--no-checkpoints`.

### JetBrains / Zed / Neovim (ACP)

```bash
pnpm --filter @ninjacode/acp-agent build
export ANTHROPIC_API_KEY=sk-ant-...
node apps/acp-agent/dist/index.js
```

Register it in the IDE's ACP settings — see
[`apps/acp-agent/acp-manifest.json`](apps/acp-agent/acp-manifest.json). Debug mode is not
supported over ACP yet; use the VS Code extension or the CLI.

### Benchmarks

```bash
pnpm bench:harness     # deterministic mock suite
pnpm bench             # full run; live providers need an API key
```

See [apps/bench/README.md](apps/bench/README.md) for the suites, and
[docs/BENCHMARKS.md](docs/BENCHMARKS.md) for the publication rules — a score is only
publishable from a bundle built on a clean tree, and no live benchmark runs on a pull
request.

## Where the harness stands

[docs/HARNESS.md](docs/HARNESS.md) lists what the harness guarantees and the known limits
(tokenizer, sandbox, `web_search`, missing tools). Feature coverage vs Cursor / Copilot is
in [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md).

## Debug mode

When ordinary agent edits keep guessing wrong, switch to **Debug**:

1. Describe the bug — expected vs actual, plus repro steps.
2. The agent forms 3-5 hypotheses and instruments the code with tagged logs
   (`NINJACODE-DEBUG` markers).
3. A local log server collects runtime NDJSON into `.ninjacode/debug.log`.
4. You reproduce the bug; the agent reads the evidence, applies a minimal fix, then strips
   the instrumentation.

## Connecting to a gateway

Set `ninjacode.provider` to `gateway` and `ninjacode.gatewayUrl` to your gateway's base URL,
then authenticate to obtain an account key. Models are loaded from the gateway's
`GET /v1/models` endpoint using the shared registry in `@ninjacode/providers`. BYOK needs no
gateway at all.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) (conventions, harness
invariants, clean-code budgets). Contributors sign the [CLA](CLA.md) on their first PR.

## License

NinjaCode Agent is free software licensed under the **GNU General Public License, version 2**
(GPL-2.0-only). See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

The **NinjaCode** name and logos are trademarks of Ninja Tools Software and are not covered
by the GPL grant: forks must rebrand.
