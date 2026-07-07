## Project Overview

This is a WordPress plugin collection called "Fair Event Plugins" for event
organization with fair pricing models. It is a monorepo. npm workspaces:
`fair-events`, `fair-audience`, `fair-timetable`, `fair-payments-connector`,
`fair-finance`, `fair-form`, `fair-platform`, the feature-flag companions
`fair-events-experimental` and `fair-payments-connector-experimental`, and the
shared `fair-events-shared` package. The list in the root `package.json` is
authoritative.

## Reference Docs

Detailed guides live next to this file. Load the relevant one **before** working
in that area — this file only carries the always-true rules.

**When writing an implementation plan** (a ticket plan, a `/plan-ticket` run, or
a plan handed to another session to implement), end it with a **"Read first"
list naming the exact reference docs** from the table below that apply to the
work. The implementer reads those docs before touching code instead of
guessing which ones matter.

| Topic                                                           | Doc                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| Commits & PR descriptions                                       | [COMMIT_GUIDE.md](./COMMIT_GUIDE.md)                           |
| Writing tickets (GitHub issues)                                 | [TICKETS.md](./TICKETS.md)                                     |
| Secure PHP patterns (DB, escaping, autoloading)                 | [PHP_PATTERNS.md](./PHP_PATTERNS.md)                           |
| Adding a plugin to the monorepo                                 | [ADDING_NEW_PLUGIN.md](./ADDING_NEW_PLUGIN.md)                 |
| REST API — frontend                                             | [REST_API_USAGE.md](./REST_API_USAGE.md)                       |
| REST API — backend / security ⚠️                                | [REST_API_BACKEND.md](./REST_API_BACKEND.md)                   |
| React admin pages                                               | [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md)             |
| Admin UI / UX rules (labels, saves, dates, destructive actions) | [UI_GUIDELINES.md](./UI_GUIDELINES.md)                         |
| Testing                                                         | [TESTING.md](./TESTING.md)                                     |
| i18n build setup (hash mapping)                                 | [I18N_SETUP.md](./I18N_SETUP.md)                               |
| Translation tooling (`npm run translation:*`)                   | [TRANSLATIONS.md](./TRANSLATIONS.md)                           |
| Webpack config                                                  | [WEBPACK_CONFIG.md](./WEBPACK_CONFIG.md)                       |
| Block creation                                                  | [BLOCK_CREATION.md](./BLOCK_CREATION.md)                       |
| Deployment / releases                                           | [DEPLOYMENT.md](./DEPLOYMENT.md), [RELEASES.md](./RELEASES.md) |

## Development Commands

```bash
# Per-plugin frontend (cd into the plugin first)
npm run start            # Dev server with hot reload
npm run build            # Build production assets

# WordPress environment
docker compose up                                   # WP :8080, MySQL, phpMyAdmin :8081
docker compose --profile cli run wpcli wp --help    # WP-CLI

# PHP quality (per plugin or from root)
composer install
vendor/bin/phpcs         # Sniff
vendor/bin/phpcbf        # Auto-fix
```

## Formatting & Build

-   **Formatting is automatic.** A PostToolUse hook
    (`.claude/hooks/format-edited-file.sh`, wired in `.claude/settings.json`)
    runs `wp-scripts format` (JS/CSS/JSON) or `phpcbf` (PHP) on each file you
    edit. Do **not** run `npm run format` manually after edits.
-   **Before committing**, run `npm run format` in the affected plugin to catch
    any files touched outside the hook (manual shell edits, generated files, or
    cross-session edits). Only stage clean, formatted files.
-   **Build is not automatic** (it is slow). After changing JS/CSS, run
    `npm run build` in the affected plugin so generated assets land before
    committing.
-   Formatters ignore `**/svn/`, `**/build/`, `**/vendor/`, `**/node_modules/`
    (see `.prettierignore` and `phpcs.xml`).

## Definition of Done

Before declaring a task finished (and before any commit), all of these hold:

1. `npm run build` ran in every plugin whose JS/CSS changed — generated assets
   are current.
2. `npm run format` ran in the affected plugin(s); no formatting noise is
   staged.
3. `vendor/bin/phpcs` is clean for changed PHP files.
4. The relevant tests ran and pass: `npm run test:js` for JS/component changes,
   `npm run test:api` for REST controllers, `npm run test:e2e` when a user flow
   changed (see [TESTING.md](./TESTING.md)).
5. New/changed UI strings follow the i18n rules
   ([UI_GUIDELINES.md](./UI_GUIDELINES.md)); translation catalogs regenerated
   when a wording pass touched them.
6. For PRs on `responsive-ui` tickets: before/after screenshots at all three
   viewports ([COMMIT_GUIDE.md](./COMMIT_GUIDE.md)).

## Critical Rules

These are cross-cutting and must never be violated. Each links to the doc with
full examples.

### Case sensitivity

macOS dev is case-insensitive; the Linux build is **case-sensitive**. Match
namespace casing to directory casing exactly, and watch file/folder name case.

### PHP / WordPress — see [PHP_PATTERNS.md](./PHP_PATTERNS.md)

-   PHP 8.0+, PSR-4 autoloading, namespace `FairPaymentsConnector` (and per-plugin equivalents).
-   DB queries: `wpdb::prepare()` with `%i` for table/column names, `%s`/`%d`/`%f`
    for values.
-   Always prevent direct file access, sanitize input, escape output.
-   Hidden admin pages: pass `''` (not `null`) as the parent slug to
    `add_submenu_page()`. `null` triggers PHP 8.1+ deprecation warnings because
    WordPress runs the slug through `wp_normalize_path()` (`strpos`/`str_replace`).
-   **Don't use PHP templates.**

### REST API — see [REST_API_BACKEND.md](./REST_API_BACKEND.md) ⚠️ & [REST_API_USAGE.md](./REST_API_USAGE.md)

Backend:

-   Controllers extend `WP_REST_Controller` and live in `src/API/` (uppercase
    "API"). Register routes on `rest_api_init`.
-   **Never verify nonces manually** — WordPress does it automatically for
    `apiFetch`. Implement `*_permissions_check` instead.
-   **Never use `__return_true` for authenticated endpoints.** Use
    `is_user_logged_in` or a `current_user_can(...)` check. `__return_true` is
    only for genuinely public endpoints (webhooks, anonymous forms), with a
    comment saying why.
-   Validate/sanitize all input; return proper status codes (401/403/404/500).

Frontend:

-   Always use `apiFetch()` from `@wordpress/api-fetch` with **hardcoded paths**
    starting with `/` (e.g. `/fair-payments-connector/v1/payments`). Never raw `fetch()`,
    never `rest_url()` URL construction.
-   Register blocks from `build/`, not `src/`. Add `viewScript` files to the
    webpack entries.

### React admin pages — see [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md)

-   PHP registers the menu and renders `<div id="root">`; React uses
    `@wordpress/components`; all data flows through `apiFetch`.
-   Layout: `src/Admin/{page-name}/` (entry `index.js` + component), controller in
    `src/API/`, built to `build/admin/{page-name}/`.
-   Canonical examples: **fair-audience** (most admin pages), fair-payments-connector, fair-events.

### Frontend `viewScript`

`viewScript` files must use the defensive DOM-ready pattern: check
`document.readyState` and run immediately if not `'loading'`, otherwise wait for
`DOMContentLoaded`. Relying on `DOMContentLoaded` alone fails under caching /
deferred loading because the event may already have fired. Example:
`fair-events/src/blocks/calendar-button/frontend.js`.

### i18n — see [I18N_SETUP.md](./I18N_SETUP.md)

-   **Default:** rely on WordPress.org language packs. Do **not** call
    `load_plugin_textdomain()`. Call
    `wp_set_script_translations( $handle, '{slug}' )` without a path argument so
    core resolves JSON from `wp-content/languages/plugins/`.
-   **Opt-in (`bundled-translations` feature flag):** when the flag is on, gate
    `load_plugin_textdomain( '{slug}', false, '{slug}/languages' )` behind
    `Features::is_enabled( 'bundled-translations' )` and pass
    `Features::script_translations_path()` as the third argument of
    `wp_set_script_translations()` — it returns the bundled `build/languages/`
    path when on, `null` when off.

### Testing — see [TESTING.md](./TESTING.md)

-   Unit: `src/**/__tests__/*.test.js` (Jest). Component: `*.test.jsx` (Jest +
    RTL). API: `src/API/__tests__/*.api.spec.js` (Playwright). E2E:
    `e2e/**/*.spec.js` (Playwright).
-   Run: `npm test` (all), `npm run test:js`, `npm run test:api`, `npm run test:e2e`.
-   To verify live-WordPress behavior (rendered block output, hook side-effects,
    DB/repo calls) without a permanent test, use the **WP-CLI `eval-file` manual
    check** recipe in [TESTING.md](./TESTING.md#manual-integration-checks-wp-cli-eval-file).
    Copy a `.tmp-` script into a mounted plugin dir, run it via the `wpcli`
    service, then delete it. **Use absolute paths — never `cd … && cp/rm`**, which
    forces an approval prompt every run.

## Shared Package: fair-events-shared

Private workspace package of shared JS utilities used across the Fair Event
plugins. To consume: add
`"fair-events-shared": "*"` to the plugin's `dependencies`, export the utility
from `fair-events-shared/src/index.js`, and import it
`from 'fair-events-shared'`. Uses ES modules; tested with Jest + Babel.

## Adding a New Plugin

Follow [ADDING_NEW_PLUGIN.md](./ADDING_NEW_PLUGIN.md). Root files to update:
`package.json` (workspaces + scripts),
`.github/workflows/continuous-integration.yml` (vendor cache),
`.github/workflows/deploy-to-environment.yml` (deploy list, if applicable),
`compose.yml` (volume mounts), `scripts/sync-wp-versions.js`,
`scripts/sync-changelog.js`.
