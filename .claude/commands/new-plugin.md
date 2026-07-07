---
description: Scaffold a new plugin in the monorepo (drives ADDING_NEW_PLUGIN.md)
argument-hint: <fair-plugin-name> "<Description>"
---

Add a new plugin to the monorepo for: $ARGUMENTS

Work through ADDING_NEW_PLUGIN.md step by step. **Read that doc first** — the
steps below are a checklist, not a replacement for it.

Note: the doc names `fair-team` as the reference/template plugin, but it no
longer exists in this repo. Use the smallest existing plugin as the structural
template instead — **`fair-platform`** (it has `src/Core/Plugin.php`, `src/API/`,
a couple of admin pages, and no blocks). Copy its layout and rename
`fair-platform` → the new slug and `FairPlatform` → the PascalCase namespace.

1. Create `fair-<name>/` with the required files and directory structure,
   adapted from `fair-platform`.
2. Make the root-monorepo updates (verify each against the **current** file
   contents — the line numbers in the doc are approximate):
   - `package.json` — workspaces array + `start`, `format:php`, `dist-archive:*`,
     `svn:tag:*`, `svn:rm` scripts
   - `.github/workflows/php-ci.yml` — vendor cache path
   - `.github/workflows/deploy-acroyoga.yml` — deploy list (only if deploying)
   - `compose.yml` — volume mounts in BOTH the `wordpress` and `wpcli` services
   - `scripts/sync-wp-versions.js` and `scripts/sync-changelog.js` — plugin config
3. Build & verify:
   `npm install` → `(cd fair-<name> && composer install)` →
   `npm run build --workspace=fair-<name>` → `npm run makepot` →
   `npm test --workspace=fair-<name>`. Confirm `build/map.json` is generated.
4. Create an initial changeset (`/release` or `npx changeset`).

Pause and show me the plan before creating files.
