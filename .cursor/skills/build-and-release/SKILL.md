---
name: build-and-release
description: Cut a NinjaCode Agent release — refresh README, write the Keep a Changelog entry, bump the SemVer version, build the VSIX, fix what breaks, commit and tag vX.Y.Z. Use when the user asks to release, cut a version, ship a build, bump the version, or update the changelog.
disable-model-invocation: true
---

# Build and Release

One release version for the whole repo: the extension version in `apps/vscode/package.json`, mirrored in the root `package.json`. The `.vsix` is the release artifact and the git tag `vX.Y.Z` marks it.

Dev builds keep their own counter: `pnpm --filter ninjacode build` auto-increments the patch through the `prebuild` hook. A release therefore never inherits the last dev patch — it is computed from the last **released** version (latest `v*` tag).

## Workflow

Copy this checklist and track progress:

```
- [ ] 1. Clean working tree
- [ ] 2. Scope the release
- [ ] 3. README.md
- [ ] 4. CHANGELOG.md
- [ ] 5. Version bump
- [ ] 6. Build
- [ ] 7. Fix and commit
- [ ] 8. Release commit
- [ ] 9. Tag
```

### 1. Clean working tree

```bash
git status --short
```

If anything is pending, **ask the user** what to do with it before going further. Never fold unrelated work into the release commit: commit it first, grouped by concern, one commit per concern.

### 2. Scope the release

```bash
git describe --tags --abbrev=0        # last released version
git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
```

No tag yet (first release) means the whole history is in scope. Cross-check with the top version heading of `CHANGELOG.md`.

Read the diff, not just the subjects — commit messages under-report breaking changes.

### 3. Update README.md

- Delete instructions that no longer match the code: commands (`package.json` scripts), settings (`contributes.configuration` in `apps/vscode/package.json`), keybindings, paths, provider lists.
- Add a new capability only when it changes how someone installs, configures or uses NinjaCode. The README is not a changelog; no version history, no per-release bullets.

### 4. Update CHANGELOG.md

Two files, same content: the root `CHANGELOG.md`, and `apps/vscode/CHANGELOG.md`, which is the copy vsce packs into the VSIX and the Marketplace renders. Write the root one, then `cp CHANGELOG.md apps/vscode/CHANGELOG.md`.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Create the file with the standard header on first release.

- Sections, in this order, omitting empty ones: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- Newest version first, heading `## [X.Y.Z] - YYYY-MM-DD` (ISO date), plus an `## [Unreleased]` section at the top.
- Entries are curated for humans: one line per user-visible change, not a dump of commit subjects. Several commits usually collapse into one entry; refactors invisible to users get no entry.
- Breaking changes, removals and deprecations are always listed.

### 5. Bump the version

[SemVer 2.0.0](https://semver.org/spec/v2.0.0.html), applied to the last released version:

| Change | Bump |
|---|---|
| Bug fixes only | patch |
| New backward-compatible features | minor |
| Breaking change (settings, protocol, CLI flags, tool names) | major |

**Ask the user before any major bump.** While the version is `0.y.z` the public API is unstable, so a breaking change may still ship as a minor — ask.

Write the target version to **both** `apps/vscode/package.json` and the root `package.json`, and use it in the `CHANGELOG.md` heading.

### 6. Build the release

```bash
export NINJACODE_BUMP=skip
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint && pnpm depcruise && pnpm knip
pnpm --filter ninjacode package
```

`NINJACODE_BUMP=skip` disables the `prebuild` auto-bump so the build and the VSIX land on the exact target version. Export it for the whole sequence, not just the packaging step: `pnpm build` runs the extension `build` through turbo, which triggers `prebuild` too. Turbo only forwards the variable because `turbo.json` lists it under `globalPassThroughEnv` — without that entry, strict env mode hides it and the build silently bumps past the target.

`pnpm depcruise` needs Node >= 22 even though the repo supports Node 20; on Node 20 it refuses to run and CI covers it instead.

Check the versions after every build: `node -p "require('./package.json').version"`.

Verify the artifact name matches the target version.

### 7. Fix and commit

Fix whatever the build, typecheck, tests or lint report. Each fix is its own commit, in the repo's existing message style, landed **before** the release commit. Rerun step 6 until it is green.

If a fix changes user-visible behavior, add it to the CHANGELOG entry.

### 8. Release commit

Only the release files:

```bash
git add README.md CHANGELOG.md apps/vscode/CHANGELOG.md package.json apps/vscode/package.json
git commit -m "Release X.Y.Z"
```

### 9. Tag

```bash
git tag vX.Y.Z
```

The tag, the CHANGELOG heading and the VSIX version must be the same three digits. Pushing the commit and the tag is the user's call — do not push unless asked.

## Out of scope

Marketplace, Open VSX and ACP Registry publishing are covered by [docs/PUBLISHING.md](../../../docs/PUBLISHING.md).
