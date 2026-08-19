# Capacités de l'agent NinjaCode

## 🎯 Niveau fonctionnel

| Capacité | Description |
|---|---|
| **Agentic Coding** | Boucle autonome : LLM → appel d'outils → exécution → itération, dans les 4 modes (Ask / Plan / Agent / Debug) |
| **Chat & Inline Edit** | Chat webview complet, `Ctrl/Cmd+I` inline edit sur la sélection, `Ctrl/Cmd+Shift+I` quick chat. Il n'y a pas de raccourci `Ctrl/Cmd+K` |
| **Ghost text (completions)** | `InlineCompletionItemProvider` — suggestions au fil de la frappe |
| **Code actions** | Explain, Fix, Review — diagnostics intégrés |
| **Modes d'interaction** | **Ask** (lecture seule), **Plan** (plan versionné dans `.ninjacode/plans/` + carte résumé inline dans le chat avec View plan / choix du modèle / Execute plan, onglet Plan dédié), **Agent** (exécution complète), **Debug** (hypothèses + instrumentation) |
| **Checkpoints** | Shadow-git par étape sous `.ninjacode/checkpoints.git` : restauration/redo en un clic, rollback par requête |
| **Review d'éditions proposées** | Accept/reject par fichier ou hunk, avec gate de sécurité pour fichiers sensibles |
| **Sessions** | Historique persistant (JSON), fork, archive, rename, pin/unpin, export JSON/Markdown, réédition de messages |
| **Mentions & attachements** | Badges de contexte inline dans la zone de saisie (fichier, dossier, symbole, sélection, diff SCM, problèmes, URL, image, terminal) : insérés par `@`, par le menu `+`, par les commandes natives « Add to Chat » (explorateur, onglet, sélection, SCM, terminal) ou par drag & drop à la position du curseur — déplaçables, cliquables, avec aperçu au survol et coût en tokens |
| **Recherche codebase** | Lexicale locale (`glob`, `grep`) + recherche sémantique classée (`search_codebase`) avec index local optionnel |
| **Règles projet** | Découverte automatique de `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.ninjacode/rules/`, `copilot-instructions` — chaque source désactivable |
| **Prompts / Skills / Custom Agents** | Commandes slash (`.prompt.md`), skills à chargement progressif (`SKILL.md`, context inline/fork), custom agents avec handoff automatique (`agent_*`) |
| **MCP** | Client Model Context Protocol (stdio & HTTP streamable) — outils, ressources, prompts par serveur, secrets via `${env:NAME}` |
| **Gestion des assets** | Onglet Settings : CRUD et activation/désactivation des serveurs MCP, skills, règles et custom agents (écriture sous `.ninjacode/`, désactivations dans `.ninjacode/config.json`) |
| **Sous-agents** | Délégation isolée avec rôles spécialisés : research, planner, fast_edit, verifier — outil `delegate` pour tâches parallèles |
| **Hooks** | Cycle de vie shell (`PreToolUse`, `PostToolUse`, `Stop`) déclarés dans `.ninjacode/hooks.json` |
| **Multi-IDE** | Extension VS Code + serveur ACP pour JetBrains, Zed, Neovim |
| **CLI headless** | Mode scriptable (`ninjacode`), benchmark intégré (NinjaBench) |

---

## ⚙️ Niveau technique

| Composant | Détail |
|---|---|
| **Monorepo** | pnpm workspace + Turborepo — 4 applications, 3 packages principaux |
| **Packages** | `@ninjacode/core` (moteur agent), `@ninjacode/providers` (abstraction LLM), `@ninjacode/tools` (27 outils) |
| **Providers LLM (12 + mocks)** | Interface unifiée `complete()` / `completeStreaming()` : **anthropic**, **openai**, **deepseek**, **openrouter**, **moonshot**, **glm**, **mistral**, **xai**, **mammouth**, **openai-compatible** (générique), **local** (Ollama/LM Studio/vLLM/llama.cpp), **gateway** (NinjaCode Gateway), plus **mock/echo** (tests). Deux transports seulement : Messages API (Anthropic) et Chat Completions (tout le reste) |
| **Prompt caching** | Cache-control ephemeral (Anthropic, max 4 breakpoints) + prefix-matching automatique avec `prompt_cache_key` (OpenAI, gateway) → KV-cache hit rate optimisé via préfixe byte-stable |
| **Vision / Multimodal** | Support des images (`ContentPart[]`) dans les messages pour les modèles compatibles (Claude, GPT-4o, etc.) ; sur un modèle texte seul, le badge image passe en erreur explicite et l'envoi se dégrade au lieu d'échouer. Les images sont comptées dans l'estimation de contexte, pas traitées comme gratuites |
| **Extended Thinking / Reasoning** | Anthropic : budget de tokens de réflexion ; les blocs `thinking` sont streamés vers l'UI **et** rejoués signés au tour suivant, sinon le raisonnement est facturé puis jeté à chaque tour. OpenAI et compatibles : reasoning effort (low/medium/high/xhigh) |
| **Edit format auto-selection** | Choix automatique `edit_file` (string_replace) vs `apply_patch` (diff unifié) selon le modèle. Source unique : `harnessProfiles.ts` dans `@ninjacode/core`, résolu par modèle exact, puis famille de provider, puis défaut. Le catalogue de modèles décrit les modèles, il ne configure pas la boucle |
| **Completion verification** | Avant de terminer : vérification des diagnostics IDE (erreurs) + commandes shell optionnelles déclarées dans `.ninjacode/verify.json`. L'échec est condensé en lignes de diagnostic (`verifyOutput.ts`) plutôt que tronqué par la tête, sinon le résumé d'erreur de `tsc`/`vitest`, qui est en fin de sortie, n'atteint jamais le modèle. `ninjacode init-verify` (CLI) et « Configurer les commandes de vérification » (VS Code) amorcent le fichier depuis la stack détectée |
| **Loop detection** | Appels d'outils répétitifs identiques : guidance corrective à 4 répétitions, arrêt propre (`stopped`) à 7 — un avertissement ignoré n'est pas une condition de terminaison |
| **Garde anti-exploration** | Budget de tours consommé à 50 % puis 80 % sans le moindre outil d'écriture : recadrage explicite dans l'historique (`editProgress.ts`). Le mode d'échec dominant sur SWE-bench n'est pas la mauvaise édition, c'est l'absence d'édition |
| **Garde anti-relecture** | Comptage des lectures par chemin, indépendamment des offsets (`readChurn.ts`) : un fichier relu 4 fois déclenche un rappel nommant le fichier, une seule fois par chemin. La détection de boucle empreinte les arguments, donc paginer un même fichier à offsets glissants lui échappe |
| **Moteur d'agents** | Boucle LLM → ToolRegistry filtré par mode → PermissionEngine (Strict/Balanced/Autonomous) → exécution → CheckpointManager → ContextCompaction |
| **Gestion de contexte** | Compaction progressive, du gratuit vers le coûteux : truncation (8k chars par output), `softenSupersededReads`, observation masking des vieux outputs ré-exécutables (`observationMasking.ts`), puis résumé LLM sectionné en dernier recours (jamais re-résumé : les messages de compaction sont pinned). Le transcript envoyé au résumeur est borné par la fenêtre de son propre modèle, en sacrifiant les messages les plus anciens et jamais les checkpoints antérieurs ; un repli sur l'heuristique locale nomme sa cause au lieu de passer pour une compaction réussie. `ContextUsageBreakdown` détaillé émis à chaque tour |
| **Prefix de cache stable** | System prompt et tool specs byte-stables sur toute la session : le scratchpad et le plan sont injectés dans les messages (`volatileContext.ts`), jamais dans le system, sinon chaque écriture invalide le cache de prompt |
| **Permissions** | Classes de risque déterministes (read_only/write/destructive/network/shell/user) — `destructive` toujours avec approbation, y compris en autonomous et y compris quand l'hôte a pré-approuvé tous les outils. Grants session par tool:target. Le classificateur de risque lit des arguments écrits par le modèle, donc il est fail-closed : un appel inclassable est traité comme `destructive`, jamais ramené au risque statique de l'outil |
| **Rayon d'impact shell** | `run_shell` escalade en `destructive` par commande (`shellDanger.ts`) : suppression récursive, `git push --force`, `git reset --hard`, `sudo`, `dd`, `mkfs`, publication de paquet, `terraform apply/destroy`, script distant piped dans un interpréteur… Une commande ainsi classée ne peut plus être couverte par un grant de type : approuver `git status` ne couvre pas `git push --force` |
| **Fiabilité** | Retry exponentiel avec jitter (429/5xx/network, jamais après qu'un delta visible a atteint le sink), `Retry-After` honoré tel quel quand le serveur le fournit (plafonné à 60 s), erreurs Anthropic typées mappées vers un statut pour que `overloaded_error` soit retryable et `invalid_request_error` final, ToolCircuitBreaker (3 strikes puis demi-ouverture après 60 s), BudgetTracker (tokens input/output/cache + coût USD au tarif réel du modèle, plafond de 5 $ par défaut) |
| **Logs & Debug** | Logs structurés redacted (`agentLogs.ts`) + serveur HTTP de debug (token auth, NDJSON) + hypothèses (`DebugSession`) + outils debug |
| **Budgets de temps** | Timeout global d'exécution configurable (`runTimeoutMs`, 15 min par défaut) **et** bornes par tour LLM (`llmTurnGuard.ts`) : plafond par requête resserré par le budget de run restant, watchdog de flux inactif, et fin du run après deux tours bloqués consécutifs. Attendre est une boucle comme une autre — un provider qui ne répond jamais ne doit pas pouvoir dépenser tout le budget wall-clock, que le circuit breaker ne surveille pas |
| **Composer du chat** | Zone de saisie `contenteditable` pilotée par un document immuable (`ComposerDoc`) : badges atomiques, historique undo/redo dédié, brouillon persisté par session, drop à la position exacte du curseur |
| **Providers de contexte** | Registre unique côté hôte (`apps/vscode/src/chat/context/*`) partagé par le menu `+`, `@`, le drag & drop et les commandes « Add to Chat » — ajouter une source = ajouter un fichier |
| **CodebaseIndex** | Index local pour `search_codebase` (lexical + sémantique optionnel) |
| **DiagnosticsProvider** | Intégration des diagnostics IDE (VS Code `languages.getDiagnostics`) pour `read_lints` et la vérification pre-complétion |
| **Base de code** | TypeScript strict, tests Vitest, CI GitHub Actions (Node 24) |
| **Backend (optionnel)** | Serveur Hono + Drizzle ORM/Postgres + Stripe — proxy API sans markup, crédits, ledger |

---

## 📋 Outils disponibles

27 outils built-in dans `@ninjacode/tools`, listés ci-dessous. Le harness en
enregistre d'autres à l'exécution, selon ce que le workspace contient :
`delegate` (sous-agents), `use_skill` (si des skills existent),
`agent_<nom>` (un par custom agent), et `mcp_search_catalog` /
`mcp_describe_tool` / `mcp_call_tool` (si des serveurs MCP sont configurés).
Le filtrage par mode retire ce qui n'a pas lieu d'être en Ask ou Plan.

### Outils fichiers

| Outil | Risque | Description |
|---|---|---|
| `read_file` | read_only | Lire un fichier (offset/limit) |
| `write_file` | write | Écrire ou créer un fichier |
| `edit_file` | write | Édition ciblée (chercher/remplacer exact, mode string_replace) |
| `apply_patch` | write | Appliquer un diff unifié |
| `delete_file` | destructive | Supprimer un fichier (approbation toujours requise) |

### Outils navigation

| Outil | Risque | Description |
|---|---|---|
| `list_dir` | read_only | Lister un répertoire (récursif jusqu'à 6 niveaux) |
| `glob` | read_only | Recherche par motif de fichier. Ignore les répertoires de build et de dépendances, mais ne lit pas `.gitignore` — c'est `grep` qui a la sémantique gitignore |
| `grep` | read_only | Recherche regex dans les fichiers (ripgrep, respecte `.gitignore`) |
| `search_codebase` | read_only | Recherche sémantique/lexicale classée |

### Outils git

| Outil | Risque | Description |
|---|---|---|
| `git_status` | read_only | État du dépôt (porcelain, borné) |
| `git_diff` | read_only | Diff borné, avec `staged` et `ref` |
| `git_log` | read_only | Historique structuré |
| `git_show` | read_only | Commit avec stat et patch |

### Outils diagnostics et session

| Outil | Risque | Description |
|---|---|---|
| `read_lints` | read_only | Lire les diagnostics IDE (erreurs, warnings) |
| `read_session_artifact` | read_only | Relire une sortie archivée de la session, paginée ou filtrée par requête — c'est ce qui rend le masquage d'observations réversible |

### Outil shell

| Outil | Risque | Description |
|---|---|---|
| `run_shell` | shell (→ destructive) | Exécuter une commande shell. Supporte des sessions persistantes interactives via `session_id`. Une commande irréversible passe en `destructive` et exige une approbation dédiée |

### Outils réseau

| Outil | Risque | Description |
|---|---|---|
| `fetch_url` | network | Récupérer le contenu d'une URL (HTML → texte) |
| `web_search` | network | Recherche web (scraping HTML DuckDuckGo — fragile, sans API) |

### Outils utilisateur

| Outil | Risque | Description |
|---|---|---|
| `ask_user` | user | Poser une question avec options cliquables |
| `request_user_action` | user | Demander une action manuelle (login, matériel, etc.) |

### Outils agent

| Outil | Risque | Description |
|---|---|---|
| `todo_write` | write | Gérer la liste de tâches (merge=true recommandé) |
| `write_scratchpad` | write | Notes durables anti-compaction (distinct du plan d'implémentation) |
| `write_plan` | write | Créer ou mettre à jour le plan de la session courante (un fichier par session, dans `.ninjacode/plans/`) |

Ces trois outils n'écrivent que sous `.ninjacode/`, donc ils sont auto-approuvés
quel que soit le mode : les soumettre à une approbation serait de la friction pure.

### Outils debug (mode Debug uniquement)

| Outil | Risque | Description |
|---|---|---|
| `record_hypotheses` | write | Enregistrer des hypothèses de debugging |
| `read_debug_logs` | read_only | Lire les logs de debug (NDJSON) |
| `clear_debug_logs` | write | Effacer les logs de debug |
| `cleanup_instrumentation` | write | Nettoyer l'instrumentation ajoutée |

---

## En une phrase

NinjaCode est un **agent de codage open-source, multi-IDE, compatible 12 providers LLM**, avec 27 outils built-in, une architecture modulaire (core/providers/tools), des checkpoints git par étape, des permissions déterministes par classe de risque, du prompt caching, du reasoning étendu, et une compatibilité fonctionnelle avec Cursor et Copilot.

Ce que le produit ne sait pas encore faire, pour éviter d'avoir à le découvrir :
pas de tokenizer exact (l'estimation de contexte reste une heuristique calibrée),
pas de défense sémantique contre l'injection de prompt, pas de confinement en
lecture du sandbox, pas de shell en arrière-plan ni d'édition multi-emplacements
en un appel, et aucun score public reproductible à ce jour. Voir
[docs/AUDIT_HARNESS_2026-08.md](docs/AUDIT_HARNESS_2026-08.md).

> Résumé généré à partir de l'architecture du dépôt — `CAPACITES_AGENT.md`
