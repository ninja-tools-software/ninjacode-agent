# Plan — Benchmark & monitoring de l'agent NinjaCode

> Objectif : mesurer en continu la qualité, le coût et la fiabilité de l'agent NinjaCode,
> et le situer face aux références du marché (Claude Code, Codex, Cursor).

## 1. Ce qu'on apprend de l'état de l'art (juillet 2026)

**Benchmarks publics dominants**

| Benchmark | Ce qu'il mesure | Références publiées |
|---|---|---|
| SWE-bench Verified (500 tâches) | Résolution d'issues GitHub réelles (Python), notée par les tests du repo | Codex/GPT-5.5 ≈ 88.7 %, Claude Code/Opus ≈ 87.6 % — proche de la saturation |
| SWE-bench Pro | Variante plus dure, multi-fichiers | Claude Code ≈ 69 %, Codex ≈ 59 % |
| Terminal-Bench 2.x (harnais Harbor) | Tâches de bout en bout dans un terminal sandboxé Docker | Codex CLI ≈ 83 %, Claude Code ≈ 79 %, Cursor Composer ≈ 62 % |

Points clés :

- Les scores mesurent le **couple harnais + modèle** : le même modèle score différemment
  selon l'agent qui l'orchestre. C'est exactement ce qu'on veut évaluer pour NinjaCode.
- SWE-bench Verified sature et souffre de contamination (les modèles ont mémorisé des
  patchs) ; Terminal-Bench est aujourd'hui le harnais public le plus transparent.
- Les deux notent la correction par des **graders déterministes** (tests, exit code),
  pas par un LLM.

**Ce que font les éditeurs (blogs Cursor & Anthropic)**

- Cursor (CursorBench) : suite interne construite à partir de **sessions réelles**
  (l'outil "Cursor Blame" relie le code commité à la requête agent qui l'a produit),
  notée sur 4 axes : correction, qualité du code, efficacité en tokens, comportement
  d'interaction. Complétée par des **expériences online** : keep rate du code généré
  (fraction du diff encore présent après N heures/jours), satisfaction utilisateur jugée
  par LLM sur les réponses suivantes, latence, tool calls, cache hit rate.
- Cursor (harness blog) : classification systématique des **erreurs de tool calls**
  (`InvalidArguments`, `UnexpectedEnvironment`, `ProviderError`, `Timeout`, …), alertes
  d'anomalie par outil et par modèle — les erreurs inconnues sont traitées comme des bugs
  du harnais.
- Anthropic ("Demystifying evals for AI agents") : commencer par des tests pass/fail
  déterministes, ajouter ensuite un **grading de transcript** (rubrique LLM pour la
  qualité du code et le comportement), mesurer pass@k et pass^k pour la variance.

**Décision d'architecture** : un harnais interne léger en TypeScript (**NinjaBench**,
ce package) pour l'itération quotidienne et le CI, plus des **adaptateurs vers les
harnais publics** (Terminal-Bench/Harbor, SWE-bench) pour la comparaison externe
crédible. On ne réinvente pas les benchmarks publics ; on s'y branche.

## 2. Architecture cible

```
apps/bench (NinjaBench)
├── tasks/                  suite interne : task.json + fixture/ + verify (déterministe)
├── src/
│   ├── runner.ts           workspace temp + git → agent → verify → métriques
│   ├── adapters/
│   │   ├── ninjacode.ts    in-process (@ninjacode/core) → télémétrie complète
│   │   └── cli.ts          CLIs concurrents headless (claude -p, codex exec, cursor-agent -p)
│   ├── report.ts           JSON + Markdown, agrégats par agent
│   └── …
├── integrations/           (phase 3) adaptateurs Terminal-Bench / SWE-bench
└── runs/                   historique des runs (gitignoré)
```

## 3. Métriques

| Axe | Métrique | Source |
|---|---|---|
| Correction | pass rate, pass@k, pass^k (fiabilité sur k essais) | commande `verify` |
| Efficacité | tokens in/out, cache read/write, coût estimé ($), nb de turns | `Agent.getCacheStats()` + `TurnTrace` |
| Vitesse | wall time par tâche, time-to-first-edit (plus tard) | runner |
| Fiabilité | taux d'erreur de tool calls, taxonomie d'erreurs, timeouts | `ToolInvocation.error`, `AgentLogChannel` |
| Empreinte | fichiers/lignes modifiés (proxy de sur-édition) | `git diff --numstat` |
| Qualité (phase 2) | rubrique LLM-judge sur le diff + transcript | grader dédié |

## 4. Roadmap

### Phase 0 — Fondation (livrée avec ce commit)

- [x] Package `@ninjacode/bench` (CLI `ninjabench` : `run`, `list`, `report`)
- [x] Runner : workspace temporaire isolé, git init, verify déterministe, diff stats
- [x] Adaptateur NinjaCode in-process (tokens, coût, turns, tool errors)
- [x] Adaptateur CLI générique (Claude Code, Codex, Cursor CLI) + `agents.example.json`
- [x] 5 tâches de départ (edit / fix ×2 / feature / terminal), rapports JSON + Markdown
- [x] Mode `--provider mock` pour un smoke test offline en CI

### Phase 1 — Suite interne sérieuse (1–2 semaines)

- [ ] Étendre à **20–50 tâches** réparties par catégorie et difficulté, dont des tâches
      multi-fichiers sur des fixtures réalistes (petits projets TS/Python complets).
      Sourcer les tâches depuis l'usage réel de NinjaCode (à la CursorBench), pas des
      puzzles synthétiques ; garder une partie du corpus privée pour limiter la
      contamination.
- [ ] `--trials N` par défaut ≥ 3 en run live ; reporter pass@k / pass^k et écart-type.
- [ ] **LLM-judge** optionnel (rubrique : qualité du code, respect du scope, absence de
      sur-édition) en plus du verify — jamais à la place.
- [ ] CI GitHub Actions : run mock à chaque PR (régression du harnais), run live
      hebdomadaire sur un sous-ensemble (budget plafonné, ~2–5 $/run) avec publication
      du rapport et **comparaison au run précédent** (détection de régression sur le
      pass rate et le coût).
- [ ] Migrer/absorber l'ancien `apps/cli/src/eval.ts` (3 cas) dans NinjaBench.

### Phase 2 — Benchmarks publics (2–3 semaines)

- [ ] **Terminal-Bench / Harbor** : packager un agent installable
      (`BaseInstalledAgent`) qui installe la CLI NinjaCode dans le conteneur et lance
      `ninjacode run <instruction> --mode agent --yes`. Exécution :
      `tb run --agent-import-path ninjabench_tb:NinjaCodeAgent --dataset terminal-bench-core`.
      Cible : score reproductible à comparer aux ~83 % (Codex) / ~79 % (Claude Code).
- [ ] **SWE-bench Lite (300 instances)** : générer les prédictions (`model_patch` JSONL)
      via `ninjabench swebench predict`, puis noter avec le harnais officiel Docker
      (`ninjabench swebench eval` → `swebench.harness.run_evaluation`).
      Comparer les agents avec `ninjabench swebench compare`. Voir
      [`integrations/README.md`](integrations/README.md).
- [ ] **SWE-bench Verified (subset)** : même pipeline, subset Verified pour score leaderboard.
- [ ] Publier les scores + méthodologie dans `docs/BENCHMARKS.md` (transparence totale :
      modèle, version du harnais, nb d'essais, coût).

### Phase 3 — Comparaison directe locale (continu)

- [ ] Affiner l'adaptateur CLI : parsing des sorties JSON des CLIs quand disponible
      (`claude -p --output-format json` expose coût/durée/turns) pour enrichir les
      métriques concurrents.
- [ ] Runs head-to-head mensuels NinjaCode vs Claude Code vs Codex vs Cursor CLI sur la
      suite interne, à modèle épinglé quand c'est possible (ex. tous sur Sonnet via BYOK)
      pour isoler l'effet **harnais**.
- [ ] Tableau de bord des écarts : où NinjaCode perd (catégorie, type d'erreur) → backlog
      d'améliorations du harnais.

### Phase 4 — Monitoring continu (production)

- [ ] Taxonomie d'erreurs de tool calls dans `@ninjacode/core` (à la Cursor :
      `InvalidArguments`, `ProviderError`, `Timeout`, `Unknown`) exposée via
      `AgentLogChannel` ; toute erreur `Unknown` = bug.
- [ ] Export **OpenTelemetry** opt-in (spans par turn/tool call, métriques tokens/coût),
      comme le fait Claude Code — utilisable par les utilisateurs self-host et par nous.
- [ ] Proxy de « keep rate » : via les checkpoints shadow-git, mesurer la fraction du
      diff agent encore présente après la session / au commit suivant.
- [ ] Signal de satisfaction : classification LLM du message utilisateur suivant
      (opt-in, anonymisé) — passe à autre chose = succès, colle une stack trace = échec.
- [ ] Alertes de régression sur les runs hebdo (pass rate −X pts, coût +Y %).

## 5. Risques & garde-fous

- **Comparaison inéquitable** : les CLIs concurrents imposent leur modèle → toujours
  présenter les résultats comme produit-vs-produit, et faire les runs à modèle épinglé
  quand on veut isoler le harnais.
- **Variance** : un run unique ne veut rien dire → trials ≥ 3, intervalles, pass^k.
- **Contamination/overfitting** : garder une partie des tâches privée, les renouveler
  régulièrement, ne jamais optimiser le harnais sur le verify d'une tâche précise.
- **Coût** : plafond budgétaire par run (le `BudgetTracker` de core le permet déjà),
  échantillonner les benchmarks publics avant les runs complets.
- **Sandboxing** : les tâches tournent dans des workspaces temporaires mais sans
  conteneur → interdire le réseau dans les tools (déjà fait : `includeNetwork: false`)
  et passer sous Docker pour les tâches "terminal" plus agressives (phase 2, on hérite
  de l'isolation Harbor/SWE-bench).

## 6. Références

- Cursor — "How we compare model quality in Cursor" (CursorBench) : cursor.com/blog/cursorbench
- Cursor — "Continually improving our agent harness" : cursor.com/blog/continually-improving-agent-harness
- Anthropic — "Demystifying evals for AI agents" : anthropic.com/engineering/demystifying-evals-for-ai-agents
- Terminal-Bench / Harbor : github.com/laude-institute/terminal-bench, harborframework.com
- SWE-bench : swebench.com (harnais Docker officiel, `sb-cli`)
