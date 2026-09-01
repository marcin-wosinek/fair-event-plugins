# Testing

This monorepo keeps tests close to the code they verify and uses a shared,
isolated WordPress lifecycle for tests that need a live site.

## Choosing a test type

| Test type | Runner | Location | Use for |
| --- | --- | --- | --- |
| JavaScript unit | Jest | `src/**/__tests__/*.test.js` | Pure utilities, transformations, and business logic |
| React component | Jest + React Testing Library | `src/**/__tests__/*.test.jsx` | Rendering, interaction, and component state |
| PHP unit | PHPUnit | `__tests__/**/*Test.php` | Pure PHP and isolated integration boundaries |
| REST API | Playwright request API | `src/API/__tests__/*.api.spec.js` | Live WordPress routes, permissions, validation, and responses |
| End to end | Playwright browser | `e2e/**/*.spec.js` | Complete browser workflows and feature integration |

Screenshot generation, Plugin Check reporting, and temporary WP-CLI checks are
supporting workflows rather than additional test types.

### Naming and placement

-   Match unit and component test names to their source files.
-   Use uppercase `API/` for REST controllers and keep API specs beside them in
    `src/API/__tests__/`.
-   Put browser tests in `e2e/`; use subdirectories when they make a suite easier
    to navigate.
-   Use `.api.spec.js` only for REST API specs and `.spec.js` for E2E specs. This
    keeps Playwright discovery unambiguous.
-   Shared helpers may live in a nearby `__tests__/helpers/` directory.

## Unit and component tests

Use `.test.js` for JavaScript logic that does not need a DOM. Use `.test.jsx`
with React Testing Library for components, including block editor components,
admin pages, and interactive UI.

Run the unit suites from the repository root:

```bash
npm test
npm run test:js
npm run test:js --workspace=fair-events
```

From a workspace, focus a file or use watch/coverage options as needed:

```bash
npm run test:js -- src/utils/__tests__/validation.test.js
npm run test:js -- --watch
npm run test:js -- --coverage
```

Jest configurations should discover `**/__tests__/**/*.test.js` and
`**/__tests__/**/*.test.jsx` and exclude `node_modules/`, `vendor/`, `build/`,
`svn/`, `e2e/`, and `.api.spec.js` files. Collect JavaScript coverage from
`src/`, excluding test, entry-point, dependency, and generated files. Aim for
70% or better coverage for new code where that measure is meaningful.

## PHP unit tests

Use PHPUnit for pure PHP logic that needs neither a WordPress bootstrap nor a
database. It is also useful for regression tests at boundaries that are hard or
unsafe to reach through an API spec, such as arguments passed to a third-party
SDK client.

The repository uses plain PHPUnit: no Brain Monkey, WP_Mock, or Mockery. A
workspace with PHP tests follows this convention:

-   `phpunit.xml` points to `__tests__/bootstrap.php` and discovers
    `__tests__/**/*Test.php`.
-   Tests use a `Fair…\Tests\…` namespace mirroring the namespace under `src/`.
-   The bootstrap loads Composer, defines `WPINC`, and provides only the small
    WordPress function stubs needed by the code under test.
-   If the subject uses `$wpdb`, provide the smallest useful fake rather than
    adding a database library.
-   `npm run test:php` invokes `vendor/bin/phpunit`; `composer test` may provide
    the same entry point.

When a workspace has a PHP suite, its `test` script must run `test:php` after
`test:js`, because the root `npm test` delegates to workspace `test` scripts.
Omit `test:php` entirely when no PHP suite exists; a script pointing at a
missing `phpunit.xml` is stale.

Examples live in `fair-events/__tests__/` and
`fair-payments-connector/__tests__/Payment/MolliePaymentHandlerTest.php`.

## Isolated WordPress test lifecycle

REST API and behavioral E2E tests use the same lifecycle runner and an isolated
`@wordpress/env` `tests` instance. The normal commands own the instance they
start, wait for WordPress readiness, run the selected suite, and stop the
instance after success, failure, or interruption.

| Environment | Tool | Port |
| --- | --- | --- |
| Regular development | `docker compose up` | 8080 |
| Isolated API/E2E tests | `@wordpress/env` | **8889** |

The runner supplies `CI=1`, `WP_BASE_URL=http://localhost:8889`,
`WP_ADMIN_USER=admin`, `WP_ADMIN_PASS=password`, and
`WP_ADMIN_PASSWORD=password`. Both password names remain available while
existing specs use both conventions. The regular development stack is not
started or required.

An owned run refuses to use an already-running test instance so it can never
stop services started elsewhere. For a faster feedback loop, explicitly start
the instance and pass `--reuse`; reused runs check readiness but skip builds,
Composer installation, provisioning, and cleanup.

```bash
npm run test:e2e:setup
npm run test:api:local -- --reuse --workspace=fair-events
npm run test:e2e:local -- --reuse e2e/smoke.spec.js
npm run test:e2e:teardown
```

The raw `test:api` and `test:e2e` scripts remain available for CI and advanced
debugging with a manually managed environment. Prefer the `:local` commands for
normal development.

### Troubleshooting lifecycle runs

Use the last phase heading in the output:

-   **Browser validation**: install Chromium with
    `npx playwright install chromium`. Host-library or launch errors remain
    visible in Playwright output.
-   **Preparation**: inspect workspace build or production Composer output.
-   **Startup/readiness**: inspect Docker, `wp-env`, permalink, and WordPress
    readiness output.
-   **API/E2E execution**: the environment is ready; a non-zero result comes
    from Playwright discovery, startup, or an assertion.
-   **Cleanup**: the runner reports stop failures separately. A cleanup error
    becomes the command status only when no earlier phase failed.

### REST API tests

Use Playwright's request API for real HTTP tests of REST routes. API specs should
cover authentication and permissions, validation, response shape, errors, and
observable WordPress behavior. They use test-only Basic Auth supplied by
`e2e/mu-plugins/fair-e2e-basic-auth.php`; they do not open browser pages.

Run all API suites or focus a workspace and Playwright selection:

```bash
npm run test:api:local
npm run test:api:local -- --workspace=fair-events
npm run test:api:local -- --workspace=fair-events -- GetTickets.api.spec.js --grep "returns tickets"
```

The root command runs each workspace that defines `test:api`. API-capable
workspaces should expose a script that targets `src/API/__tests__/`; workspaces
without API specs should omit it.

`.github/workflows/api-tests.yml` uses the same lifecycle command and test-only
authentication as local development. Its path filters include API sources,
Playwright configuration, wp-env configuration, lifecycle code, and test
support mu-plugins.

### End-to-end tests

Use browser E2E specs for complete journeys such as registration, RSVP,
payments, block insertion, admin workflows, or integration across features.
The root Playwright configuration discovers only the repository `e2e/` suite;
it does not automatically run every workspace E2E suite.

Run the root suite, a workspace suite, or an individual spec:

```bash
npm run test:e2e:local
npm run test:e2e:local -- --workspace=fair-events
npm run test:e2e:local -- e2e/smoke.spec.js --grep "admin login"
npm run test:e2e:local -- --workspace=fair-events -- e2e/events-week.spec.js --project=chromium
```

Playwright options keep their order and interactive modes use the same owned
lifecycle:

```bash
npm run test:e2e:local -- --headed
npm run test:e2e:local -- --debug
npm run test:e2e:local -- --ui
```

Workspace eligibility comes from the authoritative root `package.json` and
requires a `test:e2e` script. The workspace runner defaults discovery to
`e2e/`, preventing accidental API-spec execution. If a forwarded `.spec.js`
path is present, it replaces that default discovery filter.

The isolated instance mounts and activates only the plugins listed in
`.wp-env.json`. A workspace that requires an unmounted plugin fails clearly;
the runner does not silently alter provisioning.

To add a root E2E test:

1. Add a `*.spec.js` file under `e2e/`.
2. Import from `@playwright/test`.
3. Navigate with paths such as `page.goto('/wp-admin')`; `baseURL` is supplied.
4. For admin flows, log in through `/wp-login.php` with `WP_ADMIN_USER` and
   `WP_ADMIN_PASSWORD`. See `e2e/smoke.spec.js`.

Specs that capture outgoing mail or replace external services use the test-only
support layer in `e2e/mu-plugins/`. See [`e2e/README.md`](./e2e/README.md).

`.github/workflows/e2e.yml` runs the same managed lifecycle on relevant pull
requests and uploads the HTML report and traces after failures.

## Package script conventions

Workspaces expose only the scripts supported by their tests:

-   Define `test:js` when the workspace has a JavaScript suite.
-   Define `test:php` and chain it from `test` only when a PHP suite exists.
-   Define `test:api` only when API specs exist.
-   Define `test:e2e` only when workspace E2E specs exist.
-   Keep `test:api` and `test:e2e` out of plain `npm test`; both require live
    WordPress and remain opt-in.

The root lifecycle validates workspace names against the root `package.json`,
which is the authoritative workspace list.

## Specialized workflows

### WordPress.org screenshots

`fair-events/e2e/wordpress-org.spec.js` generates the plugin-directory images
at a consistent 1200×900 viewport. These scripts remain separate from the
behavioral E2E lifecycle because they use locale assets and the regular
development stack.

The spec accepts `SCREENSHOT_LOCALE` (`''` for English). Run both locale scripts
in the same session so their output does not drift:

```bash
npm run screenshots -w fair-events
npm run screenshots:es -w fair-events
```

Before a localized capture, install the relevant core and theme language packs
and generate current translation/build artifacts:

```bash
docker compose run wpcli wp language core install es_ES
docker compose run wpcli wp language theme install --all es_ES
npm run translation:untranslated -- --plugin=fair-events --locale=es_ES
npm run makemo -w fair-events
npm run build -w fair-events
```

English images are written as `assets/screenshot-N.png`; Spanish images use
`assets/screenshot-N-es.png`, the partial-locale fallback described in
[DEPLOYMENT.md](./DEPLOYMENT.md).

### Ad-hoc page screenshots

Use the headless Playwright helper for a one-off admin or public screenshot:

```bash
# npm run screenshot -- <path> <dimensions> <filename>
npm run screenshot -- "/wp-admin/admin.php?page=fair-finance-budgets" mobile budgets-mobile.png
```

Dimensions may be `desktop`, `tablet`, `mobile`, or `WIDTHxHEIGHT`. Options
include `--viewport`, `--wait <ms>`, `--wait-for <selector>`, `--no-login`,
`--upload imgbb`, and `--expiry <seconds>`. The file is written relative to the
current directory. Override `WP_BASE_URL` to target another prepared instance.

For PR embedding, add `--upload imgbb` and set `IMGBB_API_KEY` in the gitignored
repository `.env`. The command retains the local PNG and prints a public URL
and Markdown snippet. Uploads expire after 30 days by default; imgbb accepts
60–15552000 seconds, while `0` disables expiry.

> **Public exposure, synthetic data only.** Anyone with an imgbb URL can view
> the image, and GitHub caches it. Never upload participant names, email
> addresses, finance data, or other real data. Use `pr-assets/<n>` with an
> authenticated raw embed, or a manual GitHub attachment, when appropriate.

### Plugin Check reporting

`e2e/plugin-check.spec.js` installs the official Plugin Check plugin on the
wp-env tests instance and reports complete-scan error and warning counts for
each Fair Event plugin.

-   Start the instance with `npm run test:e2e:setup` first.
-   The first run needs network access to fetch Plugin Check.
-   The suite reports findings but fails only when Plugin Check cannot run or
    its output cannot be parsed.
-   Full scans are slow. Dependencies are excluded by Plugin Check defaults;
    `build/` is included because it ships.

### Manual WordPress integration checks

Use a temporary WP-CLI `eval-file` check when behavior requires a bootstrapped
WordPress instance but does not justify a permanent test—for example rendered
block output, hook side effects, or repository calls against real tables.

`compose.yml` mounts plugin directories, not loose files at the repository
root. Create a `.tmp-*.php` script, copy it into a mounted plugin with absolute
paths, execute it, then delete both copies:

```bash
cp /absolute/path/fair-event-plugins/.tmp-check.php \
   /absolute/path/fair-event-plugins/fair-audience/.tmp-check.php

docker compose --profile cli run --rm wpcli \
  wp eval-file wp-content/plugins/fair-audience/.tmp-check.php

rm -f /absolute/path/fair-event-plugins/fair-audience/.tmp-check.php \
      /absolute/path/fair-event-plugins/.tmp-check.php
```

Use absolute paths rather than `cd … && cp/rm`. The script must report a clear
result and remove any rows, posts, or users it creates. Promote a repeatedly
needed check to a permanent API or E2E test.
