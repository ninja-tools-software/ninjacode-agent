# Publishing NinjaCode Agent

## 1. GitHub (public, GPL-2.0-only)

```bash
git remote add origin git@github.com:YOUR_ORG/ninjacode-agent.git
git push -u origin main
```

- Add branch protection + required CI (`pnpm build && pnpm test`)
- Enable Discussions / Issues
- Require CLA comment on first PR ([CLA.md](../CLA.md))

The gateway backend lives in a separate private repository — never copy code from it
into this repo: it is proprietary and cannot be redistributed under the GPL.

## 2. VS Code Marketplace

1. Create a publisher at https://marketplace.visualstudio.com/manage
2. Get a Personal Access Token (Azure DevOps) with Marketplace scope
3. Package and publish:

```bash
npx pnpm --filter ninjacode build
cd apps/vscode
npx @vscode/vsce login YOUR_PUBLISHER
npx @vscode/vsce package --no-dependencies
npx @vscode/vsce publish --no-dependencies
```

Update `publisher` in `apps/vscode/package.json` before first publish.

## 3. Open VSX (VSCodium, Cursor-compatible open registry)

```bash
npx ovsx publish apps/vscode/*.vsix -p $OVSX_TOKEN
```

Create a token at https://open-vsx.org/

## 4. ACP Agent Registry (JetBrains + Zed)

1. Build and distribute `ninjacode-acp` via npm:

```bash
npx pnpm --filter @ninjacode/acp-agent build
# publish @ninjacode/acp-agent to npm (optional) or document npx path
```

2. Submit [`apps/acp-agent/acp-manifest.json`](../apps/acp-agent/acp-manifest.json) to the
   [ACP Agent Registry](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/).

3. JetBrains local test — `~/.jetbrains/acp.json`:

```json
{
  "agent_servers": {
    "NinjaCode": {
      "command": "node",
      "args": ["/absolute/path/to/ninjacode-agent/apps/acp-agent/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## 5. Pre-release checks

```bash
pnpm build && pnpm test
pnpm typecheck
pnpm lint && pnpm depcruise && pnpm knip
```

Live evals against a real provider:

```bash
NINJACODE_EVAL_KEY=$ANTHROPIC_API_KEY pnpm eval
```
