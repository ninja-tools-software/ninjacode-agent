# Publishing NinjaCode Agent

## 1. GitHub (public, GPL-2.0-only)

```bash
git remote add origin git@github.com:YOUR_ORG/ninjacode-agent.git
git push -u origin main
```

- Add branch protection + required CI (`pnpm build && pnpm test`)
- Enable Discussions / Issues
- Require CLA comment on first PR ([CLA.md](../CLA.md))

Pushing a tag `vX.Y.Z` (matching the version in `package.json` and
`apps/vscode/package.json`) runs [`.github/workflows/release.yml`](../.github/workflows/release.yml).
That workflow verifies, builds, tests, then creates a GitHub Release with:

- `ninjacode-X.Y.Z.vsix` — VS Code / Cursor / VSCodium extension
- `ninjacode-cli-X.Y.Z.cjs` — headless CLI (`node ninjacode-cli-X.Y.Z.cjs …`, Node >= 24)
- `ninjacode-acp-X.Y.Z.cjs` — ACP server for JetBrains / Zed / Neovim (`node ninjacode-acp-X.Y.Z.cjs`)

Release notes are the matching `## [X.Y.Z]` section of `CHANGELOG.md`. Re-running
the workflow on the same tag updates the assets in place.

The gateway backend lives in a separate private repository — never copy code from it
into this repo: it is proprietary and cannot be redistributed under the GPL.

## 2. VS Code Marketplace

1. Create a publisher at https://marketplace.visualstudio.com/manage
2. Get a Personal Access Token (Azure DevOps) with Marketplace scope
3. Prepare the release version explicitly and commit it:

```bash
pnpm version:bump
pnpm version:verify
git add package.json apps/vscode/package.json
git commit -m "release: v$(node -p 'require(\"./package.json\").version')"
git tag "v$(node -p 'require(\"./package.json\").version')"
```

4. Package and publish without mutating either manifest:

```bash
pnpm --filter ninjacode build
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

1. Download `ninjacode-acp-X.Y.Z.cjs` from the GitHub Release, or bundle locally:

```bash
pnpm --filter @ninjacode/acp-agent bundle
```

2. Submit [`apps/acp-agent/acp-manifest.json`](../apps/acp-agent/acp-manifest.json) to the
   [ACP Agent Registry](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/).

3. JetBrains local test — `~/.jetbrains/acp.json`:

```json
{
  "agent_servers": {
    "NinjaCode": {
      "command": "node",
      "args": ["/absolute/path/to/ninjacode-acp-X.Y.Z.cjs"],
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
pnpm check:clean-tree
pnpm typecheck
pnpm lint && pnpm depcruise && pnpm knip
pnpm version:verify
```

Live evals against a real provider:

```bash
NINJACODE_EVAL_KEY=$ANTHROPIC_API_KEY pnpm eval
```
