# SWE-bench Lite integration

NinjaBench orchestrates SWE-bench Lite (300 instances) in three phases: **predict** → **eval** (Docker) → **compare**.

## Prerequisites

- **Docker** with room to spare: the harness builds one image per instance.
- **Python 3.11+** with the official harness, ideally in its own venv:

```bash
python3 -m venv .venv-swebench && .venv-swebench/bin/pip install swebench
# then pass --python "$PWD/.venv-swebench/bin/python" to `swebench eval`
```

Validate your setup with a gold patch smoke test:

```bash
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path gold \
  --instance_ids sympy__sympy-20590 \
  --max_workers 1 \
  --run_id validate-gold
```

## Quick start

```bash
pnpm --filter @ninjacode/bench build

# 1) Generate predictions (smoke: one instance)
node apps/bench/dist/index.js swebench predict \
  --provider anthropic --model claude-sonnet-4-20250514 \
  --instance-ids sympy__sympy-20590 \
  --out runs/swebench

# 2) Evaluate with the official Docker harness
node apps/bench/dist/index.js swebench eval \
  --predictions runs/swebench/ninjacode-anthropic-claude-sonnet-4-20250514.jsonl \
  --run-id ninjacode-lite \
  --max-workers 4

# 3) Compare multiple agents
node apps/bench/dist/index.js swebench compare \
  --eval-dir runs/swebench/eval \
  --out runs/swebench/compare.md
```

## Measuring a harness change

Every run writes `<agent>.predict.json` next to its JSONL, flushed after each
instance so an interrupted run stays usable. It carries per-instance tokens,
cache reads, turns, tool mix and cost. Point a later run at it to get a delta
table appended to the report:

```bash
node apps/bench/dist/index.js swebench predict \
  --provider deepseek --model deepseek-v4-flash \
  --limit 25 --out runs/swebench/after \
  --baseline runs/swebench/baseline/ninjacode-deepseek.predict.json
```

The baseline is narrowed to the instances the new run covered and re-priced with
the current run's price table, so a smaller or differently-priced re-run stays
comparable. **Always pass `--model`**: the cost estimate comes from that model's
price table, and without it a run is priced at Anthropic rates.

## Head-to-head with competitor CLIs

Use the same predict command with `--agents` (see [`agents.example.json`](../agents.example.json)):

```bash
node apps/bench/dist/index.js swebench predict \
  --provider anthropic \
  --agents apps/bench/agents.example.json \
  --limit 300 \
  --out runs/swebench
```

Each agent writes its own JSONL file. Run `swebench eval` once per JSONL, then `swebench compare`.

## Output format

Predictions follow the official SWE-bench JSONL schema:

```json
{"instance_id":"sympy__sympy-20590","model_name_or_path":"ninjacode/anthropic/…","model_patch":"diff --git …"}
```

Eval reports are saved as `<run-id>.eval.json` under `runs/swebench/eval/<run-id>/`.

## Fairness notes

- Comparisons are **product** comparisons (harness + model), not model-only benchmarks.
- Pin models explicitly in `--model` and competitor CLI configs when isolating harness effects.
- Start with `--limit` or `--instance-ids` before running all 300 instances (cost and time).
- Default agent timeout is 1800s per instance (`--timeout-sec`).
- Keep the prompt template stable: changing `prompt.ts` changes the task and invalidates deltas against prior runs.

## Environment variables

| Variable | Purpose |
|---|---|
| `<PROVIDER>_API_KEY` | Key for the selected provider (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, …). Predict refuses to start without one |
| `NINJABENCH_API_KEY` | Overrides the provider-specific key |
| `NINJABENCH_PROVIDER` / `NINJABENCH_MODEL` | Override provider and model |
| `SWEBENCH_PYTHON` | Python executable for eval (default `python3`) |

See [`PLAN.md`](../PLAN.md) for the broader benchmark roadmap.
