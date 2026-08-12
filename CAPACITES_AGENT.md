# Capacités de l'agent NinjaCode

## 🎯 Niveau fonctionnel

| Capacité | Description |
|---|---|
| **Agentic Coding** | Boucle autonome : LLM → appel d'outils → exécution → itération, dans les 4 modes (Ask / Plan / Agent / Debug) |
| **Chat & Inline Edit** | Chat webview complet, `Ctrl/Cmd+I` inline edit, `Ctrl/Cmd+K` pour modifier une sélection |
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
| **Packages** | `@ninjacode/core` (moteur agent), `@ninjacode/providers` (abstraction LLM), `@ninjacode/tools` (23 outils) |
| **Providers LLM (11)** | Interface unifiée `complete()` / `completeStreaming()` : **anthropic**, **openai**, **deepseek**, **openrouter**, **moonshot**, **glm**, **mistral**, **openai-compatible** (générique), **local** (Ollama/LM Studio/vLLM/llama.cpp), **gateway** (NinjaCode Gateway), **mock/echo** (tests) |
| **Prompt caching** | Cache-control ephemeral (Anthropic, max 4 breakpoints) + prefix-matching automatique (OpenAI) → KV-cache hit rate optimisé via préfixe byte-stable |
| **Vision / Multimodal** | Support des images (`ContentPart[]`) dans les messages pour les modèles compatibles (Claude, GPT-4o, etc.) ; sur un modèle texte seul, le badge image passe en erreur explicite et l'envoi se dégrade au lieu d'échouer |
| **Extended Thinking / Reasoning** | Anthropic : budget tokens de réflexion. OpenAI : reasoning effort (low/medium/high) |
| **Edit format auto-selection** | Choix automatique `edit_file` (string_replace) vs `apply_patch` (diff unifié) selon le modèle et son entraînement |
| **Completion verification** | Avant de terminer : vérification des diagnostics IDE (erreurs) + commandes shell optionnelles déclarées dans `.ninjacode/verify.json`. L'échec est condensé en lignes de diagnostic (`verifyOutput.ts`) plutôt que tronqué par la tête, sinon le résumé d'erreur de `tsc`/`vitest`, qui est en fin de sortie, n'atteint jamais le modèle. `ninjacode init-verify` (CLI) et « Configurer les commandes de vérification » (VS Code) amorcent le fichier depuis la stack détectée |
| **Loop detection** | Appels d'outils répétitifs identiques : guidance corrective à 4 répétitions, arrêt propre (`stopped`) à 7 — un avertissement ignoré n'est pas une condition de terminaison |
| **Garde anti-exploration** | Budget de tours consommé à 50 % puis 80 % sans le moindre outil d'écriture : recadrage explicite dans l'historique (`editProgress.ts`). Le mode d'échec dominant sur SWE-bench n'est pas la mauvaise édition, c'est l'absence d'édition |
| **Garde anti-relecture** | Comptage des lectures par chemin, indépendamment des offsets (`readChurn.ts`) : un fichier relu 4 fois déclenche un rappel nommant le fichier, une seule fois par chemin. La détection de boucle empreinte les arguments, donc paginer un même fichier à offsets glissants lui échappe |
| **Moteur d'agents** | Boucle LLM → ToolRegistry filtré par mode → PermissionEngine (Strict/Balanced/Autonomous) → exécution → CheckpointManager → ContextCompaction |
| **Gestion de contexte** | Compaction progressive, du gratuit vers le coûteux : truncation (8k chars par output), `softenSupersededReads`, observation masking des vieux outputs ré-exécutables (`observationMasking.ts`), puis résumé LLM sectionné en dernier recours (jamais re-résumé : les messages de compaction sont pinned). `ContextUsageBreakdown` détaillé émis à chaque tour |
| **Prefix de cache stable** | System prompt et tool specs byte-stables sur toute la session : le scratchpad et le plan sont injectés dans les messages (`volatileContext.ts`), jamais dans le system, sinon chaque écriture invalide le cache de prompt |
| **Permissions** | Classes de risque déterministes (read_only/write/destructive/network/shell/user) — `destructive` toujours avec approbation, y compris en autonomous et y compris quand l'hôte a pré-approuvé tous les outils. Grants session par tool:target |
| **Rayon d'impact shell** | `run_shell` escalade en `destructive` par commande (`shellDanger.ts`) : suppression récursive, `git push --force`, `git reset --hard`, `sudo`, `dd`, `mkfs`, publication de paquet, `terraform apply/destroy`, script distant piped dans un interpréteur… Une commande ainsi classée ne peut plus être couverte par un grant de type : approuver `git status` ne couvre pas `git push --force` |
| **Fiabilité** | Retry exponentiel avec jitter (429/5xx/network, jamais après qu'un delta a atteint le sink), ToolCircuitBreaker (3 strikes puis demi-ouverture après 60 s), BudgetTracker (tokens input/output/cache + coût USD au tarif réel du modèle, plafond de 5 $ par défaut) |
| **Logs & Debug** | Logs structurés redacted (`agentLogs.ts`) + serveur HTTP de debug (token auth, NDJSON) + hypothèses (`DebugSession`) + outils debug |
| **Run timeout** | Timeout global d'exécution configurable (`runTimeoutMs`) |
| **Composer du chat** | Zone de saisie `contenteditable` pilotée par un document immuable (`ComposerDoc`) : badges atomiques, historique undo/redo dédié, brouillon persisté par session, drop à la position exacte du curseur |
| **Providers de contexte** | Registre unique côté hôte (`apps/vscode/src/chat/context/*`) partagé par le menu `+`, `@`, le drag & drop et les commandes « Add to Chat » — ajouter une source = ajouter un fichier |
| **CodebaseIndex** | Index local pour `search_codebase` (lexical + sémantique optionnel) |
| **DiagnosticsProvider** | Intégration des diagnostics IDE (VS Code `languages.getDiagnostics`) pour `read_lints` et la vérification pre-complétion |
| **Base de code** | TypeScript strict, tests Vitest, CI GitHub Actions (Node 20 & 22) |
| **Backend (optionnel)** | Serveur Hono + Drizzle ORM/Postgres + Stripe — proxy API sans markup, crédits, ledger |

---

## 📋 Outils disponibles (23)

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
| `list_dir` | read_only | Lister un répertoire |
| `glob` | read_only | Recherche par motif de fichier |
| `grep` | read_only | Recherche regex dans les fichiers |
| `search_codebase` | read_only | Recherche sémantique/lexicale classée |

### Outils diagnostics

| Outil | Risque | Description |
|---|---|---|
| `read_lints` | read_only | Lire les diagnostics IDE (erreurs, warnings) |

### Outil shell

| Outil | Risque | Description |
|---|---|---|
| `run_shell` | shell (→ destructive) | Exécuter une commande shell. Supporte des sessions persistantes interactives via `session_id`. Une commande irréversible passe en `destructive` et exige une approbation dédiée |

### Outils réseau

| Outil | Risque | Description |
|---|---|---|
| `fetch_url` | network | Récupérer le contenu d'une URL (HTML → texte) |
| `web_search` | network | Recherche web (DuckDuckGo) |

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
| `use_skill` | read_only | Charger les instructions complètes d'un skill (inline ou fork) |
| `delegate` | read_only | Déléguer à un ou plusieurs sous-agents (recherche parallèle) |

### Outils debug (mode Debug uniquement)

| Outil | Risque | Description |
|---|---|---|
| `record_hypotheses` | write | Enregistrer des hypothèses de debugging |
| `read_debug_logs` | read_only | Lire les logs de debug (NDJSON) |
| `clear_debug_logs` | write | Effacer les logs de debug |
| `cleanup_instrumentation` | write | Nettoyer l'instrumentation ajoutée |

---

## En une phrase

NinjaCode est un **agent de codage open-source, multi-IDE, compatible 11 providers LLM**, avec 24 outils, une architecture modulaire (core/providers/tools), des checkpoints git par étape, des permissions déterministes par classe de risque, du prompt caching, du reasoning étendu, et une compatibilité fonctionnelle avec Cursor et Copilot.

> Résumé généré à partir de l'architecture du dépôt — `CAPACITES_AGENT.md`
