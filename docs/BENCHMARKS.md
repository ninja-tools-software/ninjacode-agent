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
`BENCH_MAX_TOOL_ERRORS_INCREASE`.

Par défaut, un changement de liste de tâches ou de nombre d'essais fait échouer le
gate : les totaux restent visibles mais ne constituent pas une régression contrôlée.
`--allow-incompatible` existe pour l'exploration uniquement.

Le workflow hebdomadaire récupère le dernier artefact live réussi, applique les
seuils, puis conserve le nouveau rapport et le résultat des gates pendant 90 jours.
En l'absence de baseline, le premier run est publié comme artefact sans prétendre
mesurer une régression.

## Terminal-Bench 2.1 / Harbor

Prérequis : Docker, Harbor 0.21.x (`uv tool install harbor`), le bundle CLI et une
clé du fournisseur choisi.

```bash
pnpm --filter @ninjacode/cli bundle
pnpm --filter @ninjacode/bench build

# Valide Harbor + Docker, sans modèle
node apps/bench/dist/index.js harbor oracle

# Un cas : smoke coûteux, non comparable au leaderboard
node apps/bench/dist/index.js harbor smoke -m deepseek/deepseek-chat

# Dataset complet TB 2.1 : long, coûteux, comparable si le protocole reste identique
node apps/bench/dist/index.js harbor run -m deepseek/deepseek-chat -n 4
```

Le wrapper génère `apps/cli/dist/ninjacode.harbor-manifest.json` avec la version CLI,
la version de l'adaptateur, le commit (`NINJACODE_GIT_COMMIT` ou `GITHUB_SHA` en
archive sans `.git`), le SHA-256 et la taille du bundle, ainsi que la politique Node.
L'adaptateur refuse un bundle qui ne correspond pas au manifeste.

L'installation vérifie l'espace **dans le conteneur d'essai** (minimum 512 MiB).
Elle réutilise Node quand l'image fournit une version compatible, tente ensuite le
paquet système, et n'utilise le téléchargement nvm qu'en dernier recours. Ce fallback
épingle nvm 0.40.2 et Node 22.17.1. La version Node réellement utilisée est incluse
dans la version Harbor de l'agent.

Quand la CLI termine, l'adaptateur remplit `AgentContext` avec les tokens d'entrée,
de cache et de sortie et le coût. Les turns, appels/erreurs d'outils, histogramme
d'outils, cache write, session et manifeste sont placés dans `metadata`. Selon le
contrat Harbor, `n_input_tokens` inclut les tokens lus depuis le cache ; le détail
reste disponible dans `n_cache_tokens`. Si la télémétrie est absente ou invalide,
le résultat le signale au lieu d'inventer des zéros.

Un smoke (`-l 1`) et OpenThoughts-TBLite ne sont pas des scores Terminal-Bench 2.1.
Ne pas les présenter comme comparables au leaderboard.

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
