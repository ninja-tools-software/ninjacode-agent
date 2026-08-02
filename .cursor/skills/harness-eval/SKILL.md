---
name: harness-eval
description: Run and interpret NinjaBench to evaluate changes to the NinjaCode agent harness (system prompt, tools, compaction, providers). Use before/after any harness modification, when benchmarking against competitor CLIs, or when a new model is adopted.
---

# Harness Evaluation with NinjaBench

Rule of the field: the model sets the ceiling, the harness determines how close you get. Never merge a harness change (system prompt, tool set or descriptions, compaction thresholds, edit format, provider defaults) on vibes — measure it.

## Pyramid (use in this order)

```text
pnpm bench:harness  →  deterministic mock scripts through real Agent   (CI, <30s)
pnpm bench:quick    →  DeepSeek flash, deep-agentic live tasks        (~3–6 min)
SWE-bench canary → Lite                                              (validation)
```

## Quick start

```bash
pnpm --filter @ninjacode/bench build

# Deterministic gate — must stay green on every harness PR
pnpm bench:harness

# Fast live iteration
export DEEPSEEK_API_KEY=sk-...
pnpm bench:quick

# Diff two runs
node apps/bench/dist/index.js compare runs/quick/baseline.json runs/quick/run-….json

node apps/bench/dist/index.js list --suite harness
node apps/bench/dist/index.js list --suite quick
```

## Iteration loop

1. **`pnpm bench:harness`** — if this fails, fix the harness before spending LLM money.
2. **`pnpm bench:quick`** on current main → save as `runs/quick/baseline.json`.
3. Apply the change; rerun `pnpm bench:quick`.
4. **`ninjabench compare baseline after`** and inspect, in priority order:
   - **pass rate**,
   - **cache read rate** (drop ⇒ stable prefix broken — see `context-audit`),
   - **tokens / cost**,
   - **turns, tool calls, tool errors**,
   - wall time.
5. Only when quick looks good: SWE-bench canary, then Lite.

## Suite harness (no LLM)

Tasks with `scripts.json` replay tool-call sequences via `MockProvider` through the real
Agent. They target invariants: edit application, non-fatal tool errors, shell exit codes,
workspace path escapes, compaction under pressure, loop detection, circuit breaker,
`apply_patch`, `maxTurns` / timeout termination, parallel tool calls. CI runs
`pnpm bench:harness` with `--strict`.

Before blaming the harness on a quick FAIL, check whether the **verify** is wrong
(CRLF, `git diff` on a file absent from HEAD, first-run red herring in the verify itself).
A false-negative grader looks like an agent regression.

## Adding tasks

- Live: `task.json` + `fixture/`, tag `"suites": ["quick"]`.
- Deterministic: also add `scripts.json` (MockScript array), tag `"suites": ["harness"]`.
- Optional: `maxTurns`, `expectFailureKind` (`agent_error`|`timeout`), `minToolErrors`,
  `editFormat` (`patch` when scripts must call `apply_patch`).
- `verify` must be deterministic, offline, tamper-proof. Prefer content `cmp` over
  `git diff` for files the agent creates; strip `\r` before comparing text outputs.

## Competitor comparisons

`--agents apps/bench/agents.json` — product comparison only; disclose the setup.
