---
name: architecture-audit
description: Measure clean code and clean architecture health of the monorepo — oversized files, long functions, dead exports, import cycles, untested modules. Use when reviewing structural debt, before a refactoring campaign, or to check a campaign actually moved the numbers.
---

# Architecture Audit

Structural debt is measurable. Run the commands, compare against the budgets, and act on the largest gap — not on whatever file you happened to open.

## Budgets

From `clean-code.mdc` and `clean-architecture.mdc`: function <= 60 lines, file <= 400 lines (data files exempt), <= 4 params, nesting <= 3, zero dead exports, zero import cycles.

## Automated checks

```bash
pnpm lint        # size, complexity, nesting budgets (eslint.config.js)
pnpm knip        # unused files, exports, dependencies
pnpm depcruise   # dependency direction, cycles, orphan modules, licence boundary
```

These three cover most of the audit. The manual probes below find what static analysis cannot judge.

## Manual probes

Oversized files, worst first:

```bash
find packages apps -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/node_modules/*" -not -path "*/dist/*" -not -name "*.test.*" \
  | xargs wc -l | sort -rn | head -25
```

Modules holding logic with no colocated test:

```bash
for f in $(find packages/*/src apps/*/src -name "*.ts" -not -name "*.test.ts" -not -path "*/node_modules/*"); do
  [ -f "${f%.ts}.test.ts" ] || echo "$f"
done | xargs wc -l | sort -rn | head -25
```

Infrastructure reaching into logic (the signal that a decision is fused to an effect):

```bash
rg -n "from \"node:(fs|child_process)\"|Date\.now\(\)|process\.env" packages/core/src --glob '!*.test.ts'
rg -c "^import \* as vscode" apps/vscode/src/**/*.ts
```

## Reading the results

Judgement matters more than the raw counts:

- **A long data file is fine.** Model catalogs, icon sets, and type-only contracts have no branching to untangle; splitting them adds imports and removes nothing. Confirm it is data, then exempt it in `eslint.config.js` rather than "fixing" it.
- **A long function is never fine.** Line count there is a proxy for how many ideas the reader must hold at once.
- **A God object announces itself by its constructor.** Count the injected collaborators and the fields; past a dozen, the class is a namespace pretending to be an object.
- **Untested + long + branchy is the real priority.** A 400-line adapter with no decisions is lower risk than a 90-line function encoding retry rules with no test.
- **A cycle is never acceptable** — it means one module split arbitrarily in two.

## Ranking the work

Order candidates by `(blast radius of a bug) x (how often the file changes) / (cost to split)`. Concretely, in this repo: security paths first (`permissions.ts`), then the agent loop, then anything duplicated across apps, then UI. Files nobody touches, however ugly, come last.

Record the numbers before starting a campaign so the after-comparison is real rather than a feeling.
