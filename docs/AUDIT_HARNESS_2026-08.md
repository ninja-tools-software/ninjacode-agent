# Audit du harness NinjaCode — 19 août 2026

Périmètre : boucle agent, contexte et compaction, outils, permissions, adaptateurs
providers, évaluation. Remplace l'audit du 15 août, dont l'essentiel des constats
a été traité entre-temps.

## Verdict

La qualité d'ingénierie n'est pas le problème : 0 erreur ESLint, 0 cycle de
dépendance sur 699 modules, 0 export mort selon `knip`, aucun `any`, aucun
`@ts-ignore`, aucun `TODO`/`FIXME` en production.

Le problème est que la seule mesure de performance réelle disponible était un
échec à 0 %, et que ce n'était pas la faute du modèle. Grok 4.6 seul obtient
88,4 % sur Terminal-Bench 2.1 ; NinjaCode avec ce même modèle faisait 0/3 sur une
tâche du dataset. L'écart au marché venait du scaffold.

## Le constat central

La trajectoire du canary `runs/harbor/canary-high` (3 essais sur
`write-compressor`, grok-4.6) montre quatre tours normaux, puis un tour LLM de
**173 secondes** pour 132 tokens, puis **dix tours consécutifs sans aucun appel
abouti**, chacun d'exactement 60 secondes, jusqu'à épuiser les 840 secondes de
budget. Total : 1762 tokens de sortie pour 3 essais, aucun livrable.

Cause structurelle : **aucun timeout par requête LLM n'existait**. Les deux
adaptateurs se contentaient de transmettre le signal d'abandon global, sans
`AbortSignal.timeout`, sans watchdog de flux inactif, sans plafond par tour. Un
provider qui ralentit consommait donc tout le budget wall-clock, et le circuit
breaker ne protège que les outils, jamais les tours LLM.

Deux réserves d'honnêteté sur ce constat. D'abord, ces artefacts contiennent des
attributs (`llmTurnTimeouts`, `deliverableCreated`, `requestedOutputs`) absents du
code **et** de l'historique git, et des phases (`delivery`, `finalize`) qui ne
correspondent pas aux phases actuelles (`explore | execute | verify | recover`) :
le bundle benché venait de code jamais commité. Ensuite, cela signifie que le seul
résultat live du dépôt n'était pas reproductible, ce qui contredisait la politique
de [BENCHMARKS.md](BENCHMARKS.md).

## Ce que cet audit a corrigé

### Fiabilité de la boucle

`packages/core/src/llmTurnGuard.ts` borne un tour LLM : plafond par requête
(défaut 5 min, resserré par le budget de run restant), watchdog de flux inactif
(défaut 2 min sans le moindre événement), et terminaison après deux tours bloqués
consécutifs. Un tour bloqué n'a rien streamé, donc l'historique est intact et le
rejeu est sûr et cache-friendly ; la nouvelle tentative repasse par
`checkTurnPreconditions`, ce qui revérifie budget, timeout de run et abandon.

`createStreamSink` ne considère plus « de la sortie a été vue » que pour
`text_delta` et `reasoning_delta`. Auparavant un événement `usage` suffisait, ce
qui interdisait tout retry sûr sur Anthropic dès `message_start`.

### Sécurité

`safeRisk` est fail-closed : un classificateur de risque qui lève renvoie
`destructive` au lieu de retomber sur le risque statique de l'outil. Le
commentaire promettait déjà ce comportement mais le code faisait l'inverse ;
combiné à `allowAllTools` (CLI `--yes`, bench, cloud worker), un `rm -rf` dont la
classification échouait passait sans approbation. Tests adversariaux dans
`shellGrantIntegration.test.ts`.

### Extended thinking Anthropic

`anthropicStream.ts` ignorait les blocs `thinking` alors que `anthropic.ts`
envoyait `thinking.budget_tokens` : le reasoning était payé et jeté à chaque tour,
le panneau Reasoning restait vide sur Anthropic, et aucune signature n'était
conservée pour le rejeu. Le parseur gère désormais `thinking_delta`,
`signature_delta` et `redacted_thinking`, émet `reasoning_delta`, et
`toAnthropicMessages` replace les blocs signés en tête d'un tour assistant avec
tool calls. Un bloc non signé est conservé pour l'affichage mais jamais renvoyé,
puisqu'il serait rejeté.

La branche `error` du flux, exigée par `.cursor/rules/providers.mdc`, existe enfin,
avec `anthropicErrors.ts` qui mappe le type d'erreur vers un statut : un
`overloaded_error` sur un flux HTTP 200 est aussi retryable qu'un 529, et un
`invalid_request_error` reste final quel que soit le statut de transport.

### Retryabilité

`Retry-After` est lu (delay-seconds ou date HTTP) côté Anthropic et
OpenAI-compatible, porté par `LlmError.retryAfterMs`, et honoré tel quel par
`withRetry` — plafonné à 60 s, car attendre plus longtemps dans un run qui a sa
propre échéance n'achète rien. Un statut typé est désormais le verdict et non un
indice : `isRetryableLlmError` ne retombe plus sur des heuristiques de message
pour un 4xx dont le texte mentionnerait « socket ».

### Compaction

`serializeCompactionSegment` envoyait tout le segment en JSON sans vérifier la
fenêtre du modèle résumeur ; le dépassement revenait en erreur provider et
atterrissait dans le fallback heuristique sans trace. Le transcript est maintenant
borné par `compactionTranscriptBudget`, les checkpoints antérieurs ne sont jamais
la partie sacrifiée, et `CompactionInfo` porte `fallbackReason` et
`droppedFromTranscript`, journalisés par le harness.

### Reproductibilité du bench

Le manifeste Harbor enregistre `gitTreeDirty` en plus de `gitCommit`. Un bundle
construit depuis un arbre modifié n'est plus `publishable`, le lanceur avertit, et
`harbor audit` échoue. C'est ce qui rend impossible de reproduire la situation où
le seul score disponible venait de code absent de l'historique.

### Dette supprimée

- `ModelInfo.editFormat` et ses 19 déclarations dans le catalogue : jamais lues,
  alors que `.cursor/rules/providers.mdc` et le skill `add-llm-provider`
  affirmaient le contraire. `harnessProfiles.ts` est la source unique.
- `optionalTools` et `filterToolsForHarnessProfile` : aucun profil ne retirait les
  outils git, donc le filtre était une identité coûteuse.
- Entrées de `MODEL_PROFILES` qui répétaient la valeur de leur famille, ce qui
  masquait le seul champ réellement dérogatoire.
- `compactHistorySync` : seconde implémentation de la compaction, avec des seuils
  absolus ignorant la fenêtre du modèle, sans appelant en production.
- L'estimation de tokens dupliquée dans la webview, remplacée par
  `estimateTextTokens` du core. `estimateTokens` compte enfin les images, qui
  valaient zéro.

## Ce qui reste ouvert

- **Tokenizer réel.** L'estimation reste `chars/4` calibrée sur l'usage rapporté.
  Suffisant pour des gates conservateurs, imprécis sur du code dense.
- **Défense contre l'injection de prompt.** Aucun marquage du contenu non fiable
  (fichiers, `fetch_url`, MCP). La défense repose entièrement sur les permissions
  et le sandbox.
- **Confinement en lecture.** Le sandbox Seatbelt/Bubblewrap confine les écritures
  mais autorise la lecture de l'hôte hors chemins masqués.
- **`run_shell` n'est pas confiné aux chemins** : seul `cwd` est validé.
- **Outils manquants** vs marché : shell en arrière-plan avec `kill_shell`,
  édition multi-emplacements en un appel, lecture d'images.
- **`web_search`** scrape le HTML de DuckDuckGo avec deux regex.
- **Un score public reproductible** reste à produire : le subset stratifié
  Terminal-Bench 2.1 20×3 n'a pas encore tourné depuis un bundle propre.

## Repère externe

Voir [BENCHMARKS.md](BENCHMARKS.md#repère-externe). L'écart entre un modèle sous
Terminus 2 et le même modèle sous son harnais propriétaire mesure ce que vaut le
scaffold ; c'est la seule comparaison qui nous concerne.
