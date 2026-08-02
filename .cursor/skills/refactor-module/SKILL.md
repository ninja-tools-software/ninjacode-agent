---
name: refactor-module
description: Split an oversized file or God object into focused modules without breaking behavior. Use when a file exceeds ~400 lines, a function exceeds ~60 lines, a class has grown too many collaborators, or lint reports max-lines-per-function.
---

# Refactor an Oversized Module

The product has not shipped: **no API is frozen**. Rename, move, and delete freely — the only cost is updating callers, and the compiler finds them all. Never leave a compatibility re-export behind (see `no-legacy.mdc`).

## Checklist

```
- [ ] Step 1: Name the responsibilities
- [ ] Step 2: Secure the behavior with tests
- [ ] Step 3: Extract pure functions first
- [ ] Step 4: Move stateful pieces
- [ ] Step 5: Delete the old location
- [ ] Step 6: Verify
```

## Step 1: Name the responsibilities

List what the file actually does, one line each. Every line that needs "and" is two responsibilities. Group them into target modules **before** touching code — a split decided while editing tends to follow syntax rather than concepts.

Rule of thumb for a target module: its name says what it owns, and its exports all serve that one thing.

## Step 2: Secure the behavior with tests

Refactoring without tests is rewriting. Before extracting:

- Run the existing suite for the package and note what passes.
- If the code path you are about to move has no test, **write it first** against the current implementation. It is the only proof the refactor preserved behavior.
- Never adjust a test to match new behavior in the same commit as the extraction. If a test must change, the change is not a refactor and should be reasoned about separately.

## Step 3: Extract pure functions first

Pure functions move without risk and give the biggest readability win. In a long method, they are usually the inner computations: parsing, formatting, deciding, mapping.

```typescript
// Before: a 200-line method mixing decision and effect
// After: the decision is a testable export, the method is the effect
export function shouldRetry(error: unknown, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  return error instanceof LlmError && (error.status === 429 || error.status >= 500);
}
```

Once extracted, test the pure function directly and drop any scaffolding that existed only to reach it indirectly.

## Step 4: Move stateful pieces

For a class with too many collaborators, extract a collaborator that owns a coherent slice of the state plus the methods touching it. Pass it what it needs — not the whole parent.

Two traps:
- **Passing `this`** into the extracted piece recreates the coupling with extra indirection. If the new module needs the parent, the seam is wrong.
- **A cycle** between the old and new module means the split was arbitrary. Invert one edge with an injected interface (`AgentFactory` in `packages/core/src/subagents.ts` is the reference) or merge them back.

## Step 5: Delete the old location

Move, do not copy. In the same commit: update every import, delete the original symbol, and remove it from the barrel `index.ts` if it no longer belongs to the public surface. Then run `pnpm knip` — it catches the export you moved but forgot to unlist.

## Step 6: Verify

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm knip && pnpm depcruise
```

For `packages/core`, add one harness-specific check: the prompt-cache prefix (tool specs -> system prompt -> history) must stay byte-stable. Reordering tool registration or moving a value into the system prompt breaks caching silently. Run `pnpm bench` (mock) before and after and compare `cacheReadTokens` — see the `harness-eval` and `context-audit` skills.
