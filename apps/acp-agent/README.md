# NinjaCode ACP Agent

Use NinjaCode inside **JetBrains IDEs**, **Zed**, Neovim, and Emacs via the Agent Client Protocol.

## Install / run

```bash
# from monorepo
pnpm --filter @ninjacode/acp-agent bundle
node apps/acp-agent/dist/ninjacode-acp.cjs

# or a GitHub Release asset
node ninjacode-acp-<version>.cjs
```

## Environment

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `NINJACODE_API_KEY` | Provider key |
| `NINJACODE_PROVIDER` | anthropic, openai, deepseek, openrouter, … |
| `NINJACODE_MODEL` | Model id |
| `NINJACODE_YOLO` | Set to `1` to auto-approve tools (dev only) |

## JetBrains (`~/.jetbrains/acp.json`)

```json
{
  "agent_servers": {
    "NinjaCode": {
      "command": "node",
      "args": ["/absolute/path/to/ninjacode-acp.cjs"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## Zed

Add an ACP agent pointing at the same command in Zed settings / agent panel.

## Registry

See [acp-manifest.json](./acp-manifest.json) for ACP Agent Registry submission.
