# Benchmarks NinjaCode

Ce document décrit la méthodologie et les commandes reproductibles. Il ne publie
aucun score live : un score n'est publiable qu'avec son rapport brut, son manifeste,
le modèle exact, le nombre d'essais et la version du grader.

## Ce qui est mesuré

NinjaBench sépare trois niveaux :

1. La suite `harness` rejoue des scripts mock déterministes dans le vrai agent. Elle
   détecte les régressions du harnais sans appel LLM, mais ne mesure pas la qualité
   d'un modèle.
2. La suite `quick` exécute un petit corpus interne. Elle sert à l'itération et n'est
   pas un benchmark public.
3. Terminal-Bench 2.1 via Harbor et SWE-bench via leur grader officiel fournissent
   des résultats publics comparables lorsque le dataset complet et le protocole
   documenté sont respectés.

La correction vient toujours d'un grader déterministe. Les tokens, le coût, la
latence et les erreurs d'outils sont des diagnostics, pas des substituts au score.
Un résultat mesure le couple **agent + modèle + configuration**. Comparer deux CLIs
qui imposent des modèles différents est une comparaison produit, pas modèle seul.

## Commandes sans coût

```bash
pnpm install --frozen-lockfile
pnpm --filter @ninjacode/bench... build
pnpm --filter @ninjacode/bench test
python3 -m unittest discover -s apps/bench/harbor -p "test_*.py"
pnpm bench:harness
```

Le CI exécute aussi le typecheck et le lint ciblé. Aucun benchmark live ne doit être
lancé sur une pull request.

## Baseline et gates

`compare` accepte un fichier ou un répertoire. Pour un répertoire, il sélectionne
récursivement le rapport NinjaBench valide dont `startedAt` est le plus récent :

```bash
node apps/bench/dist/index.js compare \
  --baseline runs/baseline \
  --current runs/confirm \
  --max-pass-rate-drop 0.05 \
  --max-cost-increase-pct 25 \
  --max-wall-time-increase-pct 30 \
  --max-tool-errors-increase 0 \
  --output runs/compare.md
```

Les taux sont des fractions (`0.05` = 5 points de pourcentage) et les hausses de
coût/temps sont des pourcentages (`25` = 25 %). Les mêmes seuils sont configurables
avec `BENCH_MIN_PASS_RATE`, `BENCH_MAX_PASS_RATE_DROP`,
`BENCH_MAX_COST_INCREASE_PCT`, `BENCH_MAX_WALL_TIME_INCREASE_PCT` et
`BENCH_MAX_TOOL_ERRORS_INCREASE`. Les gates de promotion
`BENCH_MIN_TELEMETRY_COVERAGE` (défaut `0.95`) et
`BENCH_MAX_INFRA_ERROR_RATE` (défaut `0.05`) sont aussi appliqués.

Par défaut, un changement de liste de tâches ou de nombre d'essais fait échouer le
gate : les totaux restent visibles mais ne constituent pas une régression contrôlée.
`--allow-incompatible` existe pour l'exploration uniquement.

Le workflow hebdomadaire récupère le dernier artefact live réussi, applique les
seuils, puis conserve le nouveau rapport et le résultat des gates pendant 90 jours.
En l'absence de baseline, le premier run est publié comme artefact sans prétendre
mesurer une régression.

## Terminal-Bench 2.1 / Harbor

Prérequis : Docker, Harbor 0.21.0 (`uv tool install harbor==0.21.0`), le bundle CLI et une
clé du fournisseur choisi.

```bash
pnpm --filter @ninjacode/cli bundle
pnpm --filter @ninjacode/bench build

# Valide Harbor + Docker, sans modèle
node apps/bench/dist/index.js harbor oracle

# Plans sans coût : configuration et commande exactes, sans appel modèle
pnpm bench:harbor:plan:smoke
pnpm bench:harbor:plan:subset
pnpm bench:harbor:plan:full
pnpm bench:harbor:plan:publish

# Exécutions live explicites (jamais sur une pull request)
pnpm bench:harbor:smoke    # path-tracing × 1, canary hard ~10 min, pas un score TB 2.1
pnpm bench:harbor:subset   # subset stratifié stable 20 × 3
pnpm bench:harbor:full     # TB2.1 complet 89 × 1
pnpm bench:harbor:publish  # TB2.1 complet 89 × 3, publication uniquement

# Audit sans appel modèle
node apps/bench/dist/index.js harbor audit runs/harbor/full \
  --profile full --output runs/harbor/full/truth.md
```

Le wrapper génère `apps/cli/dist/ninjacode.harbor-manifest.json` avec la version CLI,
la version de l'adaptateur, le commit (`NINJACODE_GIT_COMMIT` ou `GITHUB_SHA` en
archive sans `.git`), le SHA-256 et la taille du bundle, ainsi que la politique Node.
Il épingle aussi Harbor 0.21.0, `xai/grok-4.6`, l'effort `xhigh`, le timeout CLI,
les multiplicateurs agent/verifier, le dataset, le profil, le nombre de tâches et
d'essais. Le lanceur refuse une version Harbor différente ; l'adaptateur refuse un
modèle ou un bundle qui ne correspond pas au manifeste.

L'installation vérifie l'espace **dans le conteneur d'essai** (minimum 512 MiB).
Elle réutilise Node quand l'image fournit une version compatible (majeur ≥ 24).
Sinon elle installe le tarball officiel Node 24.19.0 depuis `nodejs.org/dist`
(gzip, `pipefail`, binaire vérifié) au lieu d'un `apt nodejs` trop vieux ou de nvm.
La version Node réellement utilisée est incluse dans la version Harbor de l'agent.

Quand la CLI termine, l'adaptateur remplit `AgentContext` avec les tokens d'entrée,
de cache et de sortie et le coût. Les turns, appels/erreurs d'outils, histogramme
d'outils, cache write, session et manifeste sont placés dans `metadata`. Selon le
contrat Harbor, `n_input_tokens` inclut les tokens lus depuis le cache ; le détail
reste disponible dans `n_cache_tokens`. La CLI écrit d'abord une enveloppe atomique
`started`, puis une enveloppe finale. Harbor ne marque `telemetry_available=true`
qu'après validation du schéma et de toutes les métriques ; un JSON invalide ou
incomplet ne devient jamais une suite de zéros inventés.

Un smoke (`pnpm bench:harbor:smoke`) épingle `terminal-bench/path-tracing` via
`--include-task-name` (tâche Hard déjà réussie, ~10 min) et génère un
`--job-name` unique (`smoke-<timestamp>`). Ce n'est pas la première tâche du
dataset. Relancer le **même** nom dans le même `-o` reprend le job
Harbor précédent : les essais déjà notés sont conservés, les essais incomplets
peuvent être relancés, et un `config.json` incompatible fait échouer la reprise.
Pour un smoke neuf, laisser le wrapper choisir le nom, ou passer explicitement
`--job-name smoke-$(date +%Y%m%d-%H%M%S)`.

Quand l'agent a tourné et écrit une télémétrie finale, l'essai reste scorable même
s'il n'a pas produit le fichier attendu : `agent_timeout` si le plafond CLI a été
atteint, `verify_failure` si le grader échoue, `agent_exit` seulement pour un arrêt
non timeout. `NonZeroAgentExitCodeError` n'est plus une erreur d'infrastructure dès
que `telemetry_complete=true`. La trajectoire redacted est copiée dans
`/logs/artifacts/trajectory.json` quand ce répertoire existe ; `metadata.trajectory`
ne contient que le résumé (tours, time-to-first-edit, tours lecture seule,
histogramme d'outils, `stopReason`).

Un smoke (`path-tracing` × 1) et OpenThoughts-TBLite ne sont pas des scores
Terminal-Bench 2.1. Ne pas les présenter comme comparables au leaderboard.

## Taxonomie et dénominateurs

Chaque essai non réussi reçoit exactement une catégorie :

- `verify_failure` : l'agent termine, mais le grader rejette la correction ;
- `agent_timeout` : le budget agent (Harbor ou plafond CLI interne) est dépassé ;
- `agent_exit` : arrêt non timeout (crash logique, abort utilisateur) **sans**
  télémétrie finale, ou avec télémétrie `agent_exit` ;
- `verifier_timeout` : le grader ne rend pas de verdict ;
- `infra_error` : Docker, installation, dataset ou orchestration ;
- `cancelled` : annulation externe.

`verifier_timeout`, `infra_error` et `cancelled` sont affichés dans le taux
d'infrastructure et exclus du dénominateur de correction. `harbor audit` échoue
sous 95 % d'enveloppes télémétriques finales valides, au-dessus de 5 % d'erreurs
d'infrastructure, si le nombre de tâches/essais ne correspond pas au profil, ou
si `--baseline` contient une autre liste tâche/essai.

## Holdout privé externe

Le holdout reste hors du dépôt et reprend le format `task.json` + `fixture/` :

```bash
export NINJABENCH_HOLDOUT_DIR=/chemin/prive/ninjabench-holdout
export XAI_API_KEY=...
pnpm bench:holdout
```

Le corpus doit contenir 10 à 15 tâches par défaut (bornes configurables avec
`NINJABENCH_HOLDOUT_MIN_TASKS` et `NINJABENCH_HOLDOUT_MAX_TASKS`). Le manifeste
ne persiste ni le chemin externe ni son contenu : uniquement sa taille et un hash
stable du jeu de tâches. Les rapports restent sous `runs/`, ignoré par Git.

## Ablations coût / latence

Chaque rapport enregistre la variante et l'état des quatre composants :
lectures/recherches parallèles, persistance asynchrone, cache provider et deltas
de contexte volatile. `optimized` est le défaut sûr ; les variantes
`no-parallel-reads`, `no-async-persistence`, `no-provider-cache` et
`no-context-deltas` désactivent exactement un composant. `control` les désactive
tous et ne doit pas être utilisé avec le gate d'isolation.

Ces commandes affichent seulement le protocole et les commandes live ; elles
n'exécutent aucun benchmark :

```bash
pnpm bench:ablation:plan:quick -- --variant no-parallel-reads
pnpm bench:ablation:plan:holdout -- --variant no-async-persistence
pnpm bench:ablation:plan:public-subset -- --variant no-provider-cache
```

La promotion compare d'abord quick ×3, puis le holdout privé ×3, puis le subset
public TB2.1 20×3. Utiliser `--require-single-ablation` avec les plafonds de coût,
temps total et latence p95. Une variante n'est retenue que si la correction ne
baisse pas ; les gains de coût ou latence ne compensent jamais une régression de
correction, de déterminisme ou de reprise.

## Repère externe

Relevé du 19 août 2026, à re-vérifier avant toute comparaison publique. Ces
scores sont ceux du couple **harnais + modèle**, pas du modèle seul :

| Harnais | Modèle | Terminal-Bench 2.1 |
|---|---|---|
| Codex CLI | GPT-5.6 Sol (xhigh) | 89,5 % |
| Claude Code | Opus 5 (max effort) | 89,1 % |
| — | Grok 4.6 (high) | 88,4 % |
| Claude Code | Fable 5 | 83,8 % ± 1,2 |
| Codex CLI | GPT-5.5 | 83,1 % ± 1,1 |
| Cursor CLI | Grok 4.5 | 79,3 % ± 1,5 |
| Terminus 2 (neutre) | Fable 5 | 80,4 % ± 1,2 |
| Gemini CLI | Gemini 3.1 Pro | 70,7 % |

L'écart entre un modèle sous Terminus 2 (harnais neutre) et le même modèle sous
son harnais propriétaire mesure ce que vaut le scaffold. C'est la seule
comparaison qui nous concerne : NinjaCode se juge contre le score du même modèle
sur le même dataset, pas contre le haut du tableau obtenu avec un autre modèle.

## Reproductibilité du bundle

Le manifeste enregistre `gitCommit` **et** `gitTreeDirty`. Un bundle construit
depuis un arbre modifié contient du code absent de l'historique : son score n'est
ni reproductible ni attribuable. Dans ce cas `publishable` passe à `false`, le
lanceur affiche un avertissement, et `harbor audit` échoue avec
`bundle was built from a modified working tree`. Committer avant de lancer, ou
passer `NINJACODE_GIT_COMMIT` en archive sans `.git`.

## Publication honnête

Tout score publié doit joindre :

- le JSON/Markdown brut et le manifeste ;
- dataset et révision du grader ;
- agent, modèle résolu, fournisseur et paramètres ;
- nombre d'essais, concurrence, timeout et budget ;
- date, commit, environnement et version Node/Docker ;
- taux de réussite avec dénominateur, coût et limites connues ;
- toute différence de corpus, échec d'infrastructure ou instance exclue.

Un essai unique décrit une observation, pas la variance. Utiliser au moins trois
essais pour une baseline live et conserver les échecs ; ne sélectionner ni le
meilleur run ni seulement les instances communes après avoir vu le résultat.
