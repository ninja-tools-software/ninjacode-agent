# NinjaCode for VS Code

Frontier **agentic coding** in VS Code.

## Features

- Agent / Plan / Ask / **Debug** modes
- **Inline context badges**: attach files, folders, symbols, selections, SCM diffs, problems, terminal output, URLs and images anywhere in your sentence
- **Drag & drop everywhere**: drop Explorer files and folders, editor tabs, Source Control entries, OS files and links at the exact caret position (hold `Shift` when dragging from the Explorer — VS Code requires it for webview drops)
- **Add to Chat** context menus in the Explorer, editor tab, editor selection (`Ctrl+Alt+A`), Source Control, Problems and terminal
- Multi-provider BYOK (Anthropic, OpenAI, DeepSeek, OpenRouter, local OpenAI-compatible)
- Diff review for proposed edits (accept / reject)
- Shadow-git checkpoints
- Settings editor tab to manage MCP servers, skills, rules and custom agents (create, edit, enable/disable)
- Tool approvals with session grants
- **Debug mode**: hypothesis-driven instrumentation, local log server, runtime evidence before fixes

## Setup

1. Install the extension
2. Command palette → **NinjaCode: Set API Key**
3. Open the NinjaCode activity bar chat
4. Configure `ninjacode.provider` / `ninjacode.model` in settings
5. For hard bugs, switch the mode selector to **Debug**, describe the failure, and follow the reproduction prompts

## License

GPL-2.0-only
