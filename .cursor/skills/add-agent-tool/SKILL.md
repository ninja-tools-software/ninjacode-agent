---
name: add-agent-tool
description: Add a new built-in tool to the NinjaCode agent, from Tool implementation to registry, mode filtering, permissions, tests, and docs. Use when adding, renaming, or removing an agent tool in packages/tools.
---

# Add an Agent Tool

Every tool spec ships in every LLM request: it costs static context and adds a choice for the model. Before adding, confirm the capability cannot be covered by an existing tool (especially `run_shell`, `grep`, `glob`) or a parameter on one.

## Checklist

```
- [ ] Step 1: Implement the Tool object
- [ ] Step 2: Register it
- [ ] Step 3: Check mode + edit-format filtering
- [ ] Step 4: Permissions sanity check
- [ ] Step 5: Tests
- [ ] Step 6: Docs sync
```

## Step 1: Implement

Create the tool in the matching `packages/tools/src/*.ts` file (or a new one, exported from `index.ts`). Contract from `packages/tools/src/types.ts`:

```typescript
export const myTool: Tool = {
  name: "my_tool",                    // snake_case, verb-based, unambiguous
  description: "What it does, when to use it, and how it differs from <similar tool>.",
  risk: "read_only",                  // honest RiskClass — PermissionEngine enforces it
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Path relative to workspace root" },
      limit: { type: "number", description: "Max results (default 50)" },
    },
    required: ["file_path"],
  },
  target: (args) => String(args.file_path ?? ""),  // capability target for grants
  async execute(ctx, args) {
    if (typeof args.file_path !== "string") {
      throw new ToolError("file_path is required and must be a string", "invalid_args");
    }
    // ... respect ctx.signal for long work; resolve paths against ctx.workspaceRoot
    return { output: text, meta: { /* structured data for the harness */ } };
  },
};
```

Rules:
- Descriptions and error messages are model feedback — actionable, explicit parameter names (`file_path`, not `path` if ambiguous).
- Bound the output: default limits + truncation with a marker telling the model how to fetch more. Target well under 8k chars (core truncates at 8k as a backstop).
- Throw `ToolError` with the right code; never return error prose as a success output.
- Risk classes: writing inside workspace = `write`; deleting = `destructive`; HTTP = `network`; spawning processes = `shell`; asking the user = `user`.

## Step 2: Register

Add to `createDefaultToolRegistry()` in `packages/tools/src/index.ts`. Network tools go behind `options.includeNetwork`, debug tools behind `options.includeDebug`.

## Step 3: Mode + edit-format filtering

- `ToolRegistry.forMode` (`types.ts`): `ask` only exposes `read_only` + `ask_user`; `plan` adds todos/scratchpad. If your tool must appear in `plan` or is debug-only, update the filter lists there.
- If it is an *edit* tool, update `filterToolsForEditFormat` in `packages/core/src/editTools.ts` so only one edit format is exposed per model.

## Step 4: Permissions

No code needed — `PermissionEngine` handles it from `risk` + `target()`. Verify: in `balanced` mode, will this tool prompt when it should? `destructive` prompts even in `autonomous`; that is intentional.

## Step 5: Tests

Colocated `*.test.ts` next to the implementation. Minimum coverage:
- happy path output shape,
- `invalid_args` on bad input,
- output truncation/limit behavior,
- abort via `ctx.signal` if the tool does async work.

Run: `pnpm build && pnpm --filter @ninjacode/tools test`.

## Step 6: Docs sync

Update `CAPACITES_AGENT.md` and the README tool list with the **exact** tool name (past bug: docs said `shell`, tool is `run_shell`). If the tool changes agent behavior, run `pnpm bench` before/after (see the `harness-eval` skill).
