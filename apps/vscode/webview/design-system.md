# Design system NinjaCode — webview VS Code

Source de vérité visuelle de l’agent dans VS Code. Les tokens machine vivent dans [`src/styles/tokens.css`](src/styles/tokens.css). Ce document dit **pourquoi** et **comment** les composer. Appliquer ces tokens aux 22 CSS de domaine est un plan suivant : tant qu’un sélecteur n’est pas migré, l’écran ne doit pas bouger.

Périmètre : webview chat, settings, plan editor, Mermaid, onboarding. Hors périmètre : CLI, ACP, chrome natif VS Code (status bar, tree, input box).

---

## Positionnement

**Produit dans l’IDE, pas thème maison.** Le chrome (fond, texte, accent, polices) est hérité de VS Code. NinjaCode possède le langage produit : type, espace, contrôles, modes, statut, élévation, motion, focus.

- Pas de peau marque par-dessus Solarized ou High Contrast.
- Le dégradé shuriken (`#f5c518` → `#e63b2e`) est **marque uniquement** (empty state, activity bar). Jamais un fill de chrome.
- Références : densité Cursor, log document Claude Code, tokens type Radix / OKLCH. Pas Windsurf (trop de cartes).

---

## Principes

1. **Une idée = une taille.** Trois contrôles, cinq typos, une grille 4px. Un nouveau `23px` est un bug.
2. **Hiérarchie par le type et l’espace, pas par la boîte.** Carte = décision (approval, question, erreur). Outil = ligne de timeline. Assistant = document, pas bulle.
3. **Le mode est une couleur sémantique**, pas une déco : chaque mode a `fg / bg / border / ring`.
4. **Focus visible par défaut**, sauf le champ de saisie du chat : pas de ring, pas de bordure. Hover n’est jamais le seul chemin (edit / fork / copy).
5. **Deux densités, mêmes tokens.** `compact` (chat sidebar) et `comfortable` (settings / plan) via container queries — pas une deuxième palette.
6. **Clair / sombre / HC = une recette, pas des hex figés.** Statut et modes en OKLCH ; lightness ajustée sur `body.vscode-light` / `vscode-dark` / `vscode-high-contrast`.
7. **Sentence case.** Pas de labels 10px uppercase + tracking. Le micro-texte est `--text-micro` (11px), graisse normale.

Règle d’or pour tout nouveau CSS : **un composant n’introduit pas de px isolé.** Il compose des tokens. Exceptions : traits 1–2px, et la jauge contexte (hauteur `--space-1`).

---

## Surfaces

| Surface | Contexte | Densité |
|---|---|---|
| Chat sidebar | `AppShell` | compact (~280–420px) |
| Settings | onglet éditeur | comfortable (pleine largeur) |
| Plan editor | custom editor `.plan.md` | comfortable |
| Mermaid | panel | comfortable |
| Onboarding | remplace le log | compact |

---

## Tokens

Définis dans `tokens.css`, importé en premier par `styles.css`. Les alias historiques (`--bg`, `--accent`, `--radius-md`, `--dur-fast`…) gardent le même nom.

### Chrome (bridge VS Code)

| Token | Source |
|---|---|
| `--bg` | `--vscode-editor-background` |
| `--fg` | `--vscode-editor-foreground` |
| `--border` | `--vscode-panel-border` |
| `--accent` / `--accent-fg` | `--vscode-button-*` |
| `--muted` | `--vscode-descriptionForeground` |
| `--input-bg` / `--input-fg` | `--vscode-input-*` |
| `--font` | `--vscode-font-family` |
| `--code-font` | `--vscode-editor-font-family` |
| `--focus` | `--vscode-focusBorder` |
| `--list-hover` | `--vscode-list-hoverBackground` |
| `--list-active` | `--vscode-list-activeSelectionBackground` (défini ici ; plus de token fantôme) |
| `--panel` | `--vscode-editorWidget-background` (défini ici) |

### Surfaces

`--surface-1` / `--surface-2` / `--surface-3` : `color-mix` de `--fg` à 3 / 5 / 8 %.

`--surface-hover` : mix 6 % (aligné list-hover de secours).  
`--overlay` : `--bg` à 85 % — FAB, run-pill, boutons flottants (`backdrop-filter: blur(4px)`).

`--card-pad` reste `8px 10px` tant que les cartes domaine ne sont pas migrées. Cible phase suivante : `var(--space-2) var(--space-3)` (8×12).

### Statut (OKLCH)

Teintes calées sur les hex historiques (`#3fb950`, `#d29922`, `#f85149`) pour ne pas décaler les gauges. En thème clair, L descend pour garder ≥ 4.5:1 sur `--bg`. High contrast : tokens VS Code (`testing-iconPassed`, `charts-yellow`, `errorForeground`).

Chaque statut expose aussi `--*-bg` (mix 14 %) et `--*-border` (mix 40 %).

| Token | Rôle |
|---|---|
| `--success` | ok, ask-mode, métrique basse |
| `--warn` | attention, irreversible soft |
| `--danger` | erreur, debug-mode, destructive |

### Modes

Quatre modes produit. `--mode-agent` etc. restent les alias `fg` (compat). Les variants `*-bg` / `*-border` / `*-ring` existent pour la migration toolbar.

| Mode | Rôle | Teinte |
|---|---|---|
| agent | travail | lien VS Code / bleu |
| plan | intention | orange |
| ask | lecture | success |
| debug | diagnostic | danger |

Les fills de boutons n’utilisent **jamais** le `fg` mode seul : contraste insuffisant. Teinte à 12 % (bg) / 35 % (border).

### Segments contexte

`--seg-system` · `--seg-history` · `--seg-tools` · `--seg-output` · `--seg-attached`

Une seule source, lue par le CSS **et** par JS (`readToken` / `readTokenColor` dans `themeTokens.ts`). Interdit de redéfinir ces hex dans un sélecteur local ou dans `metricGradient.ts`.

### Typographie

| Token | Taille | Line-height | Usage |
|---|---|---|---|
| `--text-micro` | 11px | 1.3 | meta, kbd, badge, tooltip |
| `--text-sm` | 12px | 1.4 | boutons, listes, tool row, secondaire |
| `--text-md` | 13px | 1.45 | body, composer, messages |
| `--text-lg` | 15px | 1.35 | titres (empty, settings h1, onboarding) |
| `--text-display` | 28px | 1.1 | chiffre crédits |

Poids : `--weight-regular` 400 · `--weight-medium` 500 · `--weight-semibold` 600.

Interdit : 9px, 10px, 11.5px, 14px isolés. Le body utilise `--text-md`.

### Espacement — grille 4px

`--space` = 4px. Puis `--space-1` … `--space-8` = 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48.

Interdit : 3, 5, 6, 7, 9, 10, 11 px isolés. Exception : traits 1–2px.

### Contrôles et icônes

| Token | Hit | Icône | Usage |
|---|---|---|---|
| `--ctrl-sm` | 22px | `--icon-sm` 12px | pills composer, chips, close tab |
| `--ctrl-md` | 26px | `--icon-md` 14px | défaut : icon-btn, tabs, send |
| `--ctrl-lg` | 30px | `--icon-lg` 16px | header actions, FAB scroll |

Trois tailles. Pas de 24 / 28 / 15 / 20 / 11 éparpillés. Send rond = `--ctrl-md`. Header : icône `--icon-lg` (16), pas 20.

Cible header : `--header-height` 32px (grille 4px ; aujourd’hui 34px en dur).

### Rayon

`--radius-sm` 4 · `--radius-md` 6 · `--radius-lg` 8 · `--radius-xl` 12 · `--radius-full` 999.

`--radius-xl` : composer, bulle user (aujourd’hui 12px en dur dans le radius asymétrique).

### Élévation

Les tokens `--shadow-1/2/3` existent (mix de `--fg`, jamais `rgba(0,0,0,*)`). **Les overlays ne les utilisent pas.** Menu, tooltip, popover, picker, FAB, run-pill : séparation par `1px solid var(--border)` uniquement, `box-shadow: none`. Un mix de `--fg` en thème sombre produit un halo clair autour du panneau — interdit.

Usage résiduel des ombres : contrôles *non* overlay (ex. bouton Execute du plan). Pas un overlay = pas de halo.

### Z-index

`--z-sticky` 2 · `--z-overlay` 5 · `--z-dock` 10 · `--z-menu` 30 · `--z-popover` 40 · `--z-tooltip` 1000.

### Motion

| Token | Valeur | Usage |
|---|---|---|
| `--dur-instant` | 90ms | spectrum voice, press |
| `--dur-fast` | 120ms | hover, fade, closing |
| `--dur-med` | 180ms | enter panels / messages |
| `--dur-slow` | 240ms | jauges, collapse |

`--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` · `--ease-pop` `cubic-bezier(0.34, 1.56, 0.64, 1)`.

`prefers-reduced-motion: reduce` = pas d’animation, pas de `scale` au `:active`. Toute durée hors token = dette.

### Focus ring

`--focus-ring-width` 2px · `--focus-ring-offset` 2px · couleur `--focus`.

```css
outline: var(--focus-ring-width) solid var(--focus);
outline-offset: var(--focus-ring-offset);
```

Sur `:focus-visible` des interactifs (boutons, pills, tabs, menus, pickers, inputs de formulaire). **Exception — composer chat :** ni ring, ni changement de `border-color` au focus. `.composer-input` : `outline: none`. `.composer-card` : bordure `--border` constante ; **pas** de `:focus-within` vers `--focus` ni `--mode-*-ring`. Le caret (`caret-color: var(--focus)`) suffit. Le mode se lit sur la pill et le bouton send, pas sur le cadre de saisie.

---

## Densités

Mêmes tokens, rythme différent.

| | compact (chat) | comfortable (settings / plan) |
|---|---|---|
| Padding de section | `--space-2` / `--space-3` | `--space-4` / `--space-5` |
| Contrôle par défaut | `--ctrl-sm` à `--ctrl-md` | `--ctrl-md` |
| Titre | `--text-md` semibold | `--text-lg` semibold |

Mécanisme cible : `@container` sur `.app` / `.settings-page`. Pas de classe `.compact` à dupliquer à la main.

---

## Catalogue de composants

États communs, sauf mention : `default · hover · focus-visible · active · disabled · busy · selected`.

Active = `scale(0.96)` avec `--ease-out` / `--dur-fast` (sauf reduced-motion). Disabled = opacity 0.45, `cursor: not-allowed`.

### Primitives

**Button** — `default | primary | danger | subtle`. Primary = `--accent` / `--accent-fg`. Danger = `--danger` en bordure et texte, fill seulement au hover. Split (approval) : primaire à gauche, chevron menu à droite, même hauteur `--ctrl-md`.

**IconButton** — sm / md / lg uniquement. Toujours `aria-label` + tooltip. Hit area = token `--ctrl-*`, icône = `--icon-*` apparié.

**Pill** — toolbar mode / modèle. Hauteur `--ctrl-sm`, radius `--radius-full` (mode : `--radius-md`). Teinte via `--mode-*-bg/border/fg`.

**Chip** — pièce jointe, suggestion empty-state. Radius `--radius-full`, texte `--text-sm`.

**Badge** — statut, ref contexte, attachment. Texte `--text-micro`, padding `--space-1` horizontal. Ref badge : grab, highlight au hover.

**Input / Search / Select / Textarea** — fond `--input-bg`, texte `--input-fg`, bordure `--border`, focus = ring (pas seulement `border-color`). Hors composer chat (voir Contenteditable).

**Contenteditable (composer)** — même type que body (`--text-md`, lh 1.45). Placeholder `--muted`. Caret `--focus`. **Pas de ring, pas de bordure de focus** sur le champ ni sur `.composer-card`.

**Tooltip** — `GlobalTooltip`. Type `--text-micro`, pad `--space-1 --space-2`, radius `--radius-sm`, bordure `--border`, **pas d’ombre**, z `--z-tooltip`. Max 260px / 40vh.

**Menu / MenuItem / Popover** — fond `--panel`, bordure `--border`, radius `--radius-md`, pad `--space-1`, **pas d’ombre** (halo interdit). Item : hover `--list-hover`, selected `--list-active`, focus-visible ring. Fermeture : click outside + Escape (`useDismiss`).

**Collapsible header** — un pattern (bouton + chevron + `aria-expanded`). Les tool rows migreront hors de `<details>` natif.

**Segmented control** — hauteur `--ctrl-sm`, item selected = `--surface-3`.

**Kbd** — `--code-font`, `--text-micro`, radius `--radius-sm`, bordure `--border`.

### Chat

**Message user** — bulle, fond `--input-bg`, radius `--radius-xl` (asymétrique ok), inset gauche 12 %, pad `--space-3`.

**Message assistant** — document, pas de chrome, pad vertical minimal, markdown lh 1.5.

**Reasoning** — collapse, texte `--muted`, header `--text-sm`.

**Tool row** — timeline, pas de carte si `done` / `running`. Erreur : bordure `--danger-border`. Statut = icône SVG (plus de glyphs `◌ ✓ ✗`). Hauteur min `--ctrl-lg`.

**Decision cards** — Approval, Question, UserAction, GatewayError. Seules vraies cartes du log. Bordure sémantique, pad `--card-pad`, radius `--radius-md`.

**Plan card / Todo item / Run pill / Progress 2px / Empty state / ScrollFAB** — FAB = `--ctrl-lg`, overlay `--overlay`, z `--z-overlay`. FAB et run-pill : **pas d’ombre**.

### Composer

Carte : radius `--radius-lg`, fond `--input-bg`, bordure `--border` **fixe** (pas de `:focus-within` coloré). Toolbar : attach `--ctrl-sm`, pills mode/modèle, send cluster (send / stop / mic / enhance / spectrum). Send = cercle `--ctrl-md`. Overlays : ContextPicker, Autocomplete, ContextMeter, menus mode/modèle — z `--z-menu`, bordure `--border`, **pas de `box-shadow`**.

### Navigation

Session tabs = hauteur `--ctrl-md`. Header cible `--header-height` 32px. Settings : nav + section `.card` (`--surface-1`, `--radius-lg`). History / Plans = popover, bordure `--border`, z `--z-popover`, **pas d’ombre**.

### Feedback

Live dot, spinner, meters (contexte + crédits). **Pas de toast in-webview** : les notifications passent par `vscode.window.show*Message`.

### Markdown

Code block : fond `--surface-3`, radius `--radius-md`, `--code-font`, `--text-sm`. Mermaid : thème dérivé des tokens VS Code via `mermaidTheme.ts` (lecture `readTokenColor`).

---

## Accessibilité

- Ring `--focus` 2px / offset 2px sur `:focus-visible` de tout interactif, **sauf** le champ de saisie du chat (`.composer-input` / `.composer-card`) : pas de ring, pas de bordure de focus.
- Actions aujourd’hui hover-only (edit / fork / copy) : visibles au `:focus-within` + raccourci clavier. (Implémentation = plan suivant.)
- Contraste statut / mode ≥ 4.5:1 sur `--bg` en light et dark — d’où OKLCH et paires light.
- `prefers-reduced-motion` et `forced-colors` sont des variantes officielles, pas des afterthoughts.
- Icon-only = `aria-label` (via `t()`) + tooltip. Pas de `title` dupliqué.

### Clavier (contrat)

| Contexte | Raccourcis |
|---|---|
| Composer | Enter envoi, Shift+Enter newline, Escape menus / voix |
| Menus / pickers | flèches, Enter, Escape |
| Plan editor | Cmd/Ctrl+Enter exécute |
| Extension | voir `package.json` contributes.keybindings |

---

## i18n

Toute string UI, y compris `aria-label`, passe par `t()`. EN = source inline ; FR = `bundle.l10n.fr.json`.

Dette connue (hors de ce plan) : PlanApp, MermaidApp, PlanCard, HypothesesPanel, DragTip, ToolCard (« Input / Output / Error »), LogEntry (« Reasoning », copy), ContextMeter (« tok used »), gateway badges, status bar host.

---

## Pont JS

Les couleurs sémantiques ne se dupliquent pas en hex dans le TS. [`src/themeTokens.ts`](src/themeTokens.ts) expose `readToken`, `readTokenColor`, `tokenToRgb`. Fallbacks = les RGB historiques, pour les tests sans DOM et le premier paint.

`metricGradient.ts` interpole ; il lit `--success` / `--warn` / `--danger` via ce pont.

---

## Checklist nouveau style

1. Le px que j’ajoute existe-t-il déjà comme token ? Sinon, je n’ajoute pas une taille, je demande si l’échelle doit bouger.
2. Couleur : chrome VS Code, surface, statut, mode, ou segment — pas un hex.
3. Interactive : hover **et** `:focus-visible` (sauf composer chat : pas de ring / pas de bordure au focus). Overlay (menu, tooltip, popover, picker, FAB) : bordure, **jamais** `box-shadow`.
4. Copy : `t()`, sentence case, interpolation `{name}`.
5. Motion : `--dur-*` + `--ease-*`, et un chemin reduced-motion.
