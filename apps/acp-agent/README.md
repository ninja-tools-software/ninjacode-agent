# NinjaCode ACP Agent

Use NinjaCode inside **JetBrains IDEs**, **Zed**, Neovim, and Emacs via the Agent Client Protocol.

## Install / run

```bash
# from monorepo
pnpm --filter @ninjacode/acp-agent build
node apps/acp-agent/dist/index.js

# or after npm publish
npx @ninjacode/acp-agent
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
      "args": ["/absolute/path/to/ninjacode/apps/acp-agent/dist/index.js"],
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
