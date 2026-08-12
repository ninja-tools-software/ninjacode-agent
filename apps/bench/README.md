# NinjaBench

Benchmark & monitoring harness for the NinjaCode agent — and head-to-head comparison
against competitor CLIs (Claude Code, Codex, Cursor CLI).

See [PLAN.md](./PLAN.md) for the full roadmap (public benchmarks, LLM-judged quality,
online monitoring).

## What it does today

- Runs a suite of **verifiable tasks** (`tasks/<id>/task.json` + optional `fixture/`)
  in isolated temp workspaces (git-initialized for diff stats).
- **Correctness** is graded by a deterministic `verify` shell command (exit 0 = pass) —
  same philosophy as SWE-bench / Terminal-Bench.
- Measures per run: pass/fail, wall time, files/lines changed, and for NinjaCode
  (in-process) also tokens, cache hits, estimated cost, turns, tool calls and tool errors.
- Three layers: deterministic **harness** suite (CI), live **quick** suite (iteration),
  SWE-bench (validation).

## Pyramid

```text
pnpm bench:harness   →  mock + scripts.json through the real Agent  (CI gate, <30s, $0)
pnpm bench:quick     →  DeepSeek flash, deep-agentic tasks         (~3–6 min, cents)
SWE-bench Lite       →  predict + Docker eval                      (hours, validation)
```

If `bench:harness` fails, the harness itself regressed — no need to spend LLM money.
If harness is green and quick regresses, look at prompt / tools / compaction.
Only promote to SWE-bench when quick looks good.

## Quick start

```bash
pnpm install
pnpm --filter @ninjacode/bench build

# Deterministic harness gate (no API key) — run on every PR
pnpm bench:harness

# Fast live iteration loop (DeepSeek flash)
export DEEPSEEK_API_KEY=sk-...
pnpm bench:quick

# Compare two runs
node apps/bench/dist/index.js compare runs/quick/baseline.json runs/quick/run-….json

# Full live run with Anthropic (slower, for confirmation)
export ANTHROPIC_API_KEY=sk-ant-...
node apps/bench/dist/index.js run --provider anthropic --trials 3

# List tasks
node apps/bench/dist/index.js list --suite harness
node apps/bench/dist/index.js list --suite quick
```

## Suite `harness` (deterministic)

Tasks under `tasks/harness-*/` ship a `scripts.json`: a sequence of MockProvider turns
(tool calls) replayed through the real Agent / ToolRegistry / PermissionEngine /
compaction path. A failing verify means the **harness** broke, not the model.

Scenarios cover edit chains, error recovery, shell failures, permission denials,
irreversible shell commands staying gated, the `verify.json` retry loop,
large-output compaction pressure, loop detection, circuit breaker, `apply_patch`,
maxTurns / timeout termination, and parallel tool calls in one completion.
Use `"editFormat": "patch"` when a scripted task must exercise `apply_patch`
(mock defaults to string_replace which filters that tool out).

## Suite `quick` (live iteration)

Discriminative medium/hard tasks (plus deep-agentic ones: ETL pipeline, flaky-test
recovery, haystack cross-ref, API migration, policy constraints, state machine).
`bench:quick` uses `--concurrency 4 --max-turns 20`.

Save a good run as `runs/quick/baseline.json` and diff later runs against it.
When pass rate is flat, compare turns / tokens / tool errors / cost.

## Adding a task

```
tasks/
  my-task/
    task.json        # id, description, category, difficulty, prompt, verify, suites?
    fixture/         # optional
    scripts.json     # optional: MockProvider scripts for suite harness
```

Rules of thumb:

- `verify` must be **deterministic** and self-contained (no network).
- Use `git diff --quiet HEAD -- <file>` inside `verify` to forbid test tampering.
- Tag `"suites": ["harness"]` for scripted CI gates; `"suites": ["quick"]` for live iteration.
- Optional task fields: `maxTurns`, `expectFailureKind`, `minToolErrors`, `editFormat`.

## Verify pitfalls (false negatives)

A buggy grader costs more than a missing task — it attributes agent failures wrongly.

- **`git diff --quiet HEAD -- file`** only works for files that exist at the fixture
  commit. New files created by the agent are untracked; after `diffStats` the index
  is reset (`git reset -q`), so staged-vs-HEAD checks on new files are meaningless.
  Prefer content comparison (`cmp` / `printf` expected) for extracted or generated files.
- **CRLF**: agents writing CSV via Python may emit `\r\n`. Normalize with
  `tr -d '\r'` before `cmp`.
- **First-run destructors**: if a test fails by design on the first run (red herring),
  the verify must consume that run with `(cmd || true)` before asserting success.
- **Never** make the verify itself the thing that fails the task when the agent already
  solved it — inspect `outputTail` / tool histograms on FAIL before blaming the harness.

## Comparing with competitors

1. **Local head-to-head** — `--agents apps/bench/agents.json` (pass rate / wall / diff only).
2. **Public benchmarks** — `ninjabench swebench predict|eval|compare` (see
   [integrations/README.md](./integrations/README.md)).

## Fairness caveats

- Competitor CLIs bring their own models; comparisons are product-level.
- Quick suite uses `--trials 1` for speed; use `--trials 3` for confirmation.
- Never quote CLI-adapter numbers as official competitor scores without disclosing setup.
