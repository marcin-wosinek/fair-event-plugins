# Testing

This monorepo keeps tests close to the code they verify and uses a shared,
isolated WordPress lifecycle for tests that need a live site.

## Choosing a test type

| Test type       | Runner                       | Location                          | Use for                                                       |
| --------------- | ---------------------------- | --------------------------------- | ------------------------------------------------------------- |
| JavaScript unit | Jest                         | `src/**/__tests__/*.test.js`      | Pure utilities, transformations, and business logic           |
| React component | Jest + React Testing Library | `src/**/__tests__/*.test.jsx`     | Rendering, interaction, and component state                   |
| PHP unit        | PHPUnit                      | `__tests__/**/*Test.php`          | Pure PHP and isolated integration boundaries                  |
| REST API        | Playwright request API       | `src/API/__tests__/*.api.spec.js` | Live WordPress routes, permissions, validation, and responses |
| End to end      | Playwright browser           | `e2e/**/*.spec.js`                | Complete browser workflows and feature integration            |

Screenshot generation, Plugin Check reporting, and temporary WP-CLI checks are
supporting workflows rather than additional test types.

### Naming and placement

- Match unit and component test names to their source files.
- Use uppercase `API/` for REST controllers and keep API specs beside them in
  `src/API/__tests__/`.
- Put browser tests in `e2e/`; use subdirectories when they make a suite easier
  to navigate.
- Use `.api.spec.js` only for REST API specs and `.spec.js` for E2E specs. This
  keeps Playwright discovery unambiguous.
- Shared helpers may live in a nearby `__tests__/helpers/` directory.

## Unit and component tests

Use `.test.js` for JavaScript logic that does not need a DOM. Use `.test.jsx`
with React Testing Library for components, including block editor components,
admin pages, and interactive UI.

Run the unit suites from the repository root:

```bash
npm test
npm run test:js
npm run test:tooling
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

### Asserting absence after an asynchronous action

Wait for the action's own visible outcome (for example `await
findByText( 'Settings saved.' )`), then assert the related state, including
absence, straight away with `queryBy…`. When the outcome and its side effects
must agree, the component should update them in the same render: set them in
the action's handler, not in an effect that reacts to changed data. Wrapping
the absence check in `waitFor` would only hide a render where they disagree.

Wait for absence separately only where the change is meant to arrive later
(for example a list that reloads after the save), and say why in a comment.
Testing Library flushes effects inside `act`, so a passing assertion does not
prove there was no inconsistent render in between. To check that, wrap the
component in React's `<Profiler onRender>` and inspect the DOM on each commit,
as the save-completion tests in
`fair-events/src/Admin/event-notifications/__tests__/` do.

Repository-level Node utilities use the built-in Node test runner under
`scripts/__tests__/*.test.mjs`; `npm test` includes them through
`test:tooling`.

## PHP unit tests

Use PHPUnit for pure PHP logic that needs neither a WordPress bootstrap nor a
database. It is also useful for regression tests at boundaries that are hard or
unsafe to reach through an API spec, such as arguments passed to a third-party
SDK client.

The repository uses plain PHPUnit 13: no Brain Monkey, WP_Mock, or Mockery.
PHPUnit is installed once, in the isolated Composer project
`tools/php-tests/`, and never in a workspace's `require-dev`. Each suite
still loads only its own workspace's production autoloader, so plugin
dependency graphs stay separate.

```bash
npm run test:php:install                          # once, and after tools/php-tests/composer.lock changes
(cd fair-events && composer install)              # each workspace you test
npm run test:php                                  # every PHP suite
npm run test:php -- --workspace=fair-events       # one suite (repeatable)
npm run test:php -w fair-events -- --filter Signup # from npm's workspace flag, PHPUnit options after --
PHP_BINARY=/path/to/php8.4 npm run test:php       # a specific PHP binary
```

The runner (`scripts/php-test-runner.mjs`) runs the suite of the workspace
it is started from, or every suite when started from the repository root.

A workspace with PHP tests follows this convention:

- `phpunit.xml` references the `tools/php-tests` schema, points to
  `__tests__/bootstrap.php`, and discovers `__tests__/**/*Test.php`. It sets
  `failOnWarning`, `failOnNotice`, `failOnDeprecation` and
  `failOnPhpunitDeprecation`. Fix what they report instead of suppressing
  it.
- Tests use a `Fair…\Tests\…` namespace mirroring the namespace under `src/`.
- Use attributes, not docblock annotations, which PHPUnit 12+ ignores:
  `#[DataProvider( 'cases' )]` with a `public static` provider,
  `#[RunInSeparateProcess]` and `#[PreserveGlobalState( false )]`.
- The bootstrap loads Composer, defines `WPINC`, and provides only the small
  WordPress function stubs needed by the code under test.
- If the subject uses `$wpdb`, provide the smallest useful fake rather than
  adding a database library.
- The workspace's `test:php` script is `node ../scripts/php-test-runner.mjs`.

When a workspace has a PHP suite, its `test` script must run `test:php` after
`test:js`. The root `npm test` runs every workspace `test:js`, then
`test:php`, then `test:tooling`. Omit `test:php` entirely when no PHP suite
exists; a script pointing at a missing `phpunit.xml` is stale.
`npm run validate:php-compat` enforces both rules.

Examples live in `fair-events/__tests__/` and
`fair-payments-connector/__tests__/Payment/MolliePaymentHandlerTest.php`.

### PHP versions

Three version ranges apply, and they are deliberately different:

| What                                                                                           | PHP                                      | Checked by                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Plugin runtime (shipped)                                                                       | 7.4, 8.0, 8.2 or 8.3 minimum per plugin  | `php-runtime` CI jobs                                           |
| PHPUnit suites and tooling                                                                     | 8.4 and 8.5 (PHPUnit 13 requires 8.4.1+) | `php-tests` CI jobs                                             |
| WordPress environments (default CI jobs, wp-env dev and tests sites, Docker Compose dev stack) | 8.5                                      | `.wp-env.json`, `compose.yml`, checked by `validate:php-compat` |

The WordPress environments run current PHP so that deprecations real sites
hit show up in development and CI. That version is not a plugin minimum;
raising it changes no `Requires PHP` or Composer `platform` value.
`npm run validate:php-compat` fails when `compose.yml`'s WordPress images or
any literal `php-version:` in `.github/workflows/` disagrees with
`.wp-env.json` `phpVersion`. Matrix legs (`${{ matrix.php }}`) are the other
two ranges and are not checked against it. To change the version, edit
`.wp-env.json` and let the check list every other place.

Per-plugin minimums and the rules for changing them are in
[PHP_PATTERNS.md § Supported PHP Versions](./PHP_PATTERNS.md#supported-php-versions).
PHPUnit 13 receives bugfixes until February 2028
(<https://phpunit.de/supported-versions.html>). Plan the next major before
then.

Contributors need PHP 8.4+ with `dom`, `json`, `libxml`, `mbstring`, `xml`,
`xmlwriter` and `tokenizer` for PHPUnit. `pcntl` is needed for
fair-timetable's time limits (PHPUnit warns without it). `gd`, `zip` and
`intl` are needed for fair-audience's spreadsheet dependency. The plugins
themselves keep supporting older PHP. Don't use 8.4+ syntax in `src/`
because the tests happen to run there.

CI covers the runtime minimums in three ways, since PHPUnit cannot run on
them:

- `php-runtime` (PHP 7.4, 8.0, 8.2, 8.3): for each workspace at that minimum,
  `node scripts/php-compat.mjs runtime --minimum=<version>` installs the
  locked production dependencies, runs `composer check-platform-reqs
--no-dev`, lints every shipped PHP file with `php -l`, and loads
  `vendor/autoload.php` (including Composer's platform check).
- `npm run test:php:compat` (in the PHP 8.4 `php-tests` job) runs
  PHPCompatibilityWP over shipped PHP with `testVersion <minimum>-`. This
  catches newer functions and APIs that `php -l` accepts. It uses the
  PHPCompatibility 10 alpha, the only line that knows PHP 8.x, which needs
  PHPCS 4. That is why it lives in `tools/php-tests/` and not beside the
  root PHPCS 3 install.
- `npm run validate:php-compat` (build job) checks the declarations.

Run the runtime check locally against an older PHP with Docker, for example
`docker run --rm -v "$PWD":/app -w /app/fair-events php:7.4-cli php -l fair-events.php`.
The CI job is the authoritative check.

### Upgrading an existing local wp-env site

A change to `phpVersion` (or anything else in `.wp-env.json`) reaches an
existing local site on its next `wp-env start`. wp-env notices the changed
configuration and rebuilds the containers, keeping the development and tests
databases. It skips that step without warning when wordpress.org is
unreachable, so do it while online:

1. Check that no run is using the instance: `pgrep -fl "playwright test"`.
2. Run `npx wp-env start`. The rebuild takes a few minutes; both databases
   are kept.
3. Check the version: `npx wp-env run cli php -v` and
   `npx wp-env run tests-cli php -v`. If either still shows the old version,
   run `npx wp-env start --update`.

Secondary worktrees follow the same steps; the ports in
`.wp-env.override.json` carry over. Don't use `wp-env destroy` for this. It
deletes the databases and images, and nothing about a version change needs
it.

### Native popup check

`npm run validate:native-popups` scans the production JavaScript in
`src/` of fair-events, fair-payments-connector, fair-form, fair-audience,
fair-events-experimental, fair-payments-connector-experimental, fair-finance,
fair-platform and fair-audience-experimental (`SCANNED_PLUGINS` in
`scripts/validate-native-popups.mjs`) for browser-native `confirm()`, `alert()` and `prompt()` — bare, or through
`window`, `globalThis` or `self`, including computed (`window[ 'alert' ]`)
and optional (`window?.confirm?.()`) forms. It parses each file, so comments,
strings, object keys, methods on other objects and locally bound functions of
the same name don't count; `__tests__/`, `*.test.*`/`*.spec.*` and `build/`
are skipped. It reports `file:line:column`, fails on a parse error, and has
no allowlist or baseline — replace the popup per
[UI_GUIDELINES.md](./UI_GUIDELINES.md#popups-and-confirmations). CI runs it
in the build job; its fixtures live in
`scripts/__tests__/validate-native-popups.test.mjs` (part of `test:tooling`).

## Isolated WordPress test lifecycle

REST API and behavioral E2E tests use the same lifecycle runner and an isolated
`@wordpress/env` `tests` instance. The normal commands own the instance they
start, wait for WordPress readiness, run the selected suite, and stop the
instance after success, failure, or interruption. That includes a
`wp-env start` that fails or is interrupted part-way: whatever containers it
brought up are stopped too. An interrupt that arrives between steps starts no
further steps. `@wordpress/env` 12 needs Node.js 22.13 or later; the
repository's Node.js minimum already covers that.

| Environment            | Tool                | Port     |
| ---------------------- | ------------------- | -------- |
| Regular development    | `docker compose up` | 8080     |
| Isolated API/E2E tests | `@wordpress/env`    | **8889** |

The runner supplies `CI=1`, `WP_BASE_URL=http://localhost:<tests port>`,
`WP_ADMIN_USER=admin`, `WP_ADMIN_PASS=password`, and
`WP_ADMIN_PASSWORD=password`. Both password names remain available while
existing specs use both conventions. The regular development stack is not
started or required.

The tests port is resolved the way wp-env resolves it: `WP_ENV_TESTS_PORT`
first, then `.wp-env.override.json` merged over `.wp-env.json`
(`env.tests.port` before `testsPort`), and 8889 by default. A second worktree
that moves its instance in `.wp-env.override.json` (for example to
`"port": 8890, "testsPort": 8891`) therefore tests its own site with the same
commands, `--reuse` included.

An owned run refuses to use an already-running test instance so it can never
stop services started elsewhere. For a faster feedback loop, explicitly start
the instance and pass `--reuse`; reused runs check readiness but skip builds,
Composer installation, provisioning, and cleanup.

```bash
npm run test:wp-env:start
npm run test:api:local -- --reuse --workspace=fair-events
npm run test:e2e:local -- --reuse e2e/smoke.spec.js
npm run test:wp-env:stop
```

Use `test:e2e:setup` only when the isolated instance also needs a full
workspace build, production Composer install, and permalink provisioning.
For an already-built tree, `test:wp-env:start` avoids repeating that work.

A `--reuse` instance kept alive across a long session of ad-hoc debugging
(manual `curl`/API calls, repeated spec runs, fixture creation) accumulates
stale posts/pages/events that never get cleaned up. That can flake unrelated
specs that count or list all items of a type, with confusing failures like
a test timing out well past what the assertion itself should take. A plain `test:wp-env:stop` + `test:wp-env:start`
does **not** clear this, because the database volume persists across a
restart. Reset it as described below. If a full-suite run surfaces failures
unrelated to the change you're testing, check whether they reproduce in
isolation (`--grep` for API specs, a spec path for E2E) before treating them as
a regression.

#### Resetting leftover test data

Signs that the tests database needs a reset:

- Local query counts far above the hosted baseline (e.g. `listings` at 1,341
  queries locally against 60 hosted).
- A spec that looks for its row on the first screen of an admin list times
  out because dozens of leftover posts or pages come first.
- A spec that expects an empty site (no event sources, no events in a week)
  fails on its first assertion.

CI starts from an empty database every time, so failures caused by leftovers
pass there.

To reset:

1. Check that no run is using the instance: `pgrep -fl "playwright test"`.
2. Run `npx wp-env reset tests`. It takes about 20 seconds and empties only the
   tests database. The development site and its data are untouched. WordPress
   is reinstalled, the plugins listed in `.wp-env.json` are activated again
   (their tables are recreated), and the `e2e/mu-plugins` support layer,
   Basic Auth included, keeps working because it is mounted from disk.
3. Restore pretty permalinks, which the reset sets back to the default:
   `npx wp-env run tests-cli wp rewrite structure '/%postname%/' --hard`.
   Owned `:local` runs do this themselves; `--reuse` runs don't.

Use `wp-env destroy` only when the containers themselves are broken. It also
deletes the Docker images, so the next start rebuilds everything. The
`cleanup-*.php` scripts in `e2e/mu-plugins/scripts/` remove one spec's
fixtures; they are not a general reset.

The raw `test:api` and `test:e2e` scripts remain available for CI and advanced
debugging with a manually managed environment. Prefer the `:local` commands for
normal development.

### Troubleshooting lifecycle runs

Use the last phase heading in the output:

- **Browser validation**: install Chromium with
  `npx playwright install chromium`. Host-library or launch errors remain
  visible in Playwright output.
- **Preparation**: inspect workspace build or production Composer output.
- **Startup/readiness**: inspect Docker, `wp-env`, permalink, and WordPress
  readiness output.
- **API/E2E execution**: the environment is ready; a non-zero result comes
  from Playwright discovery, startup, or an assertion.
- **Cleanup**: the runner reports stop failures separately. A cleanup error
  becomes the command status only when no earlier phase failed.

### Long runs: durations and one run at a time

**Full API and E2E suites run in CI, not locally.** `api-tests.yml` and
`e2e.yml` run them on every PR; together they take about 70 minutes, which is
no use as a local feedback loop. Locally, run individual tests (`--grep`) or at
most one whole spec file, then push and let CI cover the rest. Don't block
on, or wait for, a local full-suite run.

Full suites run with a single worker and take a while. Approximate figures
(November 2026; CI job = critical path with balanced shards):

| Suite                                       | Tests | Local                                     | CI job             |
| ------------------------------------------- | ----- | ----------------------------------------- | ------------------ |
| Root E2E (`test:e2e:local`)                 | 465   | ~40–55 min\*, plus ~5 min build and start | ~17 min (4 shards) |
| fair-events API (`--workspace=fair-events`) | 439   | ~12 min with `--reuse` (measured)         | —                  |
| All API workspaces (`test:api:local`)       | 1328  | ~40–55 min\*, plus ~3 min build and start | ~21 min (4 shards) |

\* Estimated from CI, where the unsharded root E2E test phase took 34–53 min
and the unsharded API test phase 39–52 min.
Local API runs have been about 1.5× slower per test than CI. Workspace E2E
suites (fair-events has 114 tests) don't run in CI. Run them with
`--workspace` and name specs by path (see
[End-to-end tests](#end-to-end-tests)). A regex filter can also match the
WordPress.org screenshot spec, which then rewrites `assets/screenshot-*.png`.

Every spec assumes it is the only client of the test database. Specs count
places and tickets, read captured mail, and change site options such as the
timezone. Two overlapping runs therefore produce failures that look like a
broken environment but are not: counts off by one (`Expected: 2, Received:
3`), unexpected `ticket_type_sold_out` 409s, extra captured emails, and
`socket hang up`. To avoid them:

- **Run one Playwright process per test instance.** That includes ad-hoc
  single-spec reruns: don't start them while a full suite is running against
  the same port. Wait, or use another worktree's instance.
- **Don't change the checkout during a run.** wp-env mounts the worktree
  live, so `git checkout`, `reset`, `rebase` or a rebuild changes the code
  under test mid-request. The tests site then logs fatals such as
  `Class "…" not found`. To compare against `main`, wait for the run to
  finish first.
- **No output for a while doesn't mean a run has died.** The line reporter
  prints one line per test, and seed-heavy specs (e.g.
  `EventStatistics.api.spec.js`) spend minutes in WP-CLI fixtures. A
  finished run ends with a summary (`N passed (12.0m)`). Until you see one,
  check `pgrep -fl "playwright test"` before starting anything else. Send
  each run's output to its own file so two runs never share one log.
- **Check the server before blaming the environment.** Read this worktree's
  tests-site PHP log with
  `docker logs "$(basename "$(npx wp-env status --json | jq -r .installPath)")-tests-wordpress-1" 2>&1 | grep "PHP Fatal"`
  (`wp-env logs` can miss these). Then rerun the failing spec on its own
  with `--retries=0`. If it passes alone, the failure came from shared state
  or an overlapping run, not from the code.
- **Worktrees with their own ports:** the `:local` runner follows
  `.wp-env.override.json`. When you run Playwright directly instead, set
  `WP_BASE_URL` to this worktree's tests port, or the specs fall back to
  another site:
  `CI=1 WP_BASE_URL=http://localhost:8891 WP_ADMIN_USER=admin WP_ADMIN_PASS=password WP_ADMIN_PASSWORD=password npx playwright test …`

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

The root command runs `npm run test:api --workspace=<name>` for each workspace
that defines `test:api`, in root `package.json` order. A failing workspace does
not stop the next one; the run fails with the first failing status and names
the failing workspaces at the end. API-capable workspaces should expose a
script that targets `src/API/__tests__/`; workspaces without API specs should
omit it.

Two runner options exist mainly for CI, and work locally too:

```bash
# Run the second of four duration-balanced API shards.
npm run test:api:local -- --shard=2/4
# Write api-results/<workspace>.json (Playwright JSON) and
# api-results/timings.json (build, Composer, wp-env start, readiness,
# each workspace, cleanup).
npm run test:api:local -- --results-dir=api-results
```

`--shard` is owned by the runner, not forwarded to Playwright. It lists every
API workspace, assigns their spec files together to shards by recorded
duration, and runs each workspace with a `--test-list` of its files in that
shard; a workspace with no files there is skipped. Combined with
`--workspace`, it runs only that workspace's part of the shard. See
[Rebalancing shards](#rebalancing-shards). `--results-dir` switches the reporters to `github,html,json`, so every
workspace also leaves an HTML report in `<workspace>/playwright-report/`.

**Run WP-CLI fixtures one at a time.** Await each `npx wp-env run` before
starting the next; don't wrap several in `Promise.all`. In CI run 41784629083,
two concurrent `wp-env run` calls left wp-env reporting `Environment not
initialized` for every later fixture, across all remaining workspaces and the
final cleanup. To test a race between server-side writers, start the
processes inside the container from one `wp-env run`. The `parallel` action of
`e2e/mu-plugins/scripts/payment-links.php` shows how: it starts each child
`wp eval-file` with `proc_open`, waits an optional `delayMs` between starts, and
returns all results in order.

`.github/workflows/api-tests.yml` uses the same lifecycle command and test-only
authentication as local development, split into four isolated shards:

- **`API shard N/4`** jobs each run
  `npm run test:api:local -- --shard=N/4 --results-dir=api-results` on their
  own runner, so every shard has its own wp-env containers, database, uploads,
  captured emails and settings. Inside a shard the suite stays sequential
  (`workers: 1`, `fullyParallel: false`, two CI retries), because specs share
  WordPress state. Shards don't cancel each other when one fails.
- **`API shard inventory`** lists every workspace's suite through its own
  `test:api` script, without WordPress, computes the same assignment as the
  shards, lists each shard through the same `--test-list` files, and fails on
  listing errors, an empty suite, or a test that is missing from every shard or
  assigned to more than one (`scripts/check-api-shards.mjs --total=4`). Test
  keys include the workspace. The uploaded inventory also records each
  shard's files and estimated seconds.
- **`API Tests`** is the single status. It fails unless the inventory check
  and all four shards succeeded, and it compares each shard's JSON results with
  the planned inventory: a planned test that never ran, or an unplanned one
  that did, fails it. Existing skips count as run; flaky retries and failures
  are listed in its step summary.

Every shard uploads `api-report-shard-N-of-4-attempt-A` (`api-results/` with
timings and JSON results, plus each workspace's HTML report and
`test-results/` traces) on success as well as failure. Open the failing shard's
job: its log ends with the failing workspaces, and its step summary has the
phase timings. Reports are not merged. The workflow also has a manual trigger
(`gh workflow run api-tests.yml --ref <branch>`) for benchmark runs.

Shards hold whole spec files, balanced by recorded duration across all
workspaces ([Rebalancing shards](#rebalancing-shards)). Change the shard count
in both the matrix and the inventory check's `--total`.

Before rebalancing, measured in November 2026 (#2153; five runs each of one commit per layout,
dispatched together, 1250 tests, PHP 8.5, Playwright 1.64.1,
`ubuntu-latest`, two CI retries, all caches warm, queue delay excluded):

| Median (range)           | Sequential (1 job) | 4 shards         |
| ------------------------ | ------------------ | ---------------- |
| Workflow elapsed (min)   | 45.3 (42.1–55.9)   | 22.9 (18.1–24.5) |
| Test step, slowest job   | 44.4 (41.2–54.9)   | 21.9 (17.0–23.1) |
| Runner minutes, all jobs | 46 (43–56)         | 66 (64–68)       |
| Failed runs              | 1 of 5             | 0 of 5           |

Sharding halves the wait for a result and costs about 45% more runner
minutes: each shard repeats ~3 minutes of setup (build, wp-env start), and the
inventory and status jobs add about 2 minutes. Shard 3 is the slowest (17–23
min of test time against 8–15 for the others), mostly because a slow
fair-payments-connector spec group lands there. Every run had the known flaky
retry in fair-audience's `SignupHookBridge` free-signup test, in both layouts.
The failed sequential run lost its wp-env site mid-suite (`Environment not
initialized`).

Its path filters include API sources, Playwright configuration, wp-env
configuration, lifecycle and shard-check code, and test support mu-plugins.

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

To save a post/page through the standard Gutenberg editor (as opposed to a
plugin's own custom admin app), the top-bar button is labeled **"Save"** for
an already-published item, not "Update" — and the screen has a second,
unrelated "Save"/"Open save panel" element, so
`getByRole('button', { name: 'Save', exact: true })` is required to avoid a
strict-mode violation.

#### Calling `wp.apiFetch` from a spec

A spec that creates fixtures with the browser's `wp.apiFetch` must wait for a
callable client first. WordPress prints `#wpadminbar` near the top of the
admin body, but the `wp-api-fetch` script loads further down the page, so
`waitForSelector('#wpadminbar')` can return while the document is still
`loading`. At that point `window.wp` already exists, holding the scripts that
loaded earlier, so the call fails with `wp.apiFetch is not a function` rather
than `wp is not defined`. The failure only shows on a slow runner and passes
on retry. This caused the block-docs examples flakes in #2152.

Wait with `waitForFunction(() => typeof window.wp?.apiFetch === 'function')`
on an admin URL before the first request, and again after every navigation.
`e2e/block-docs-examples.spec.js` does this through
`e2e/support/block-docs-api-fetch.js`. The helper waits up to 10 seconds, then
fails with the stage, URL, request and what it found instead of a client. It
sends each request exactly once. `e2e/block-docs-api-fetch.spec.js` covers it
without a WordPress site.

`.github/workflows/e2e.yml` runs the same managed lifecycle on relevant pull
requests, split into four Playwright shards:

- **`E2E shard N/4`** jobs each run `npm run test:e2e:local -- --shard=N/4` on
  their own runner, so every shard has its own wp-env containers, database,
  uploads, captured emails and settings. The runner assigns whole spec files
  by recorded duration and runs its shard's files through `--test-list`
  ([Rebalancing shards](#rebalancing-shards)). Inside a shard the suite stays
  sequential (`workers: 1`, `fullyParallel: false`), because specs share
  WordPress state. Shards don't cancel each other when one fails.
- **`E2E shard inventory`** lists the suite without WordPress, computes the
  same assignment, lists each shard through the same `--test-list`, and fails
  if the suite is empty or any test is missing from every shard or assigned to
  more than one (`scripts/check-e2e-shards.mjs`).
- **`E2E`** is the single status: it fails unless the inventory check and all
  four shards succeeded.

Every shard uploads `playwright-report-shard-N-of-4-attempt-A` (HTML report,
traces and failure screenshots, plus `e2e-results/results.json` with stats),
on success as well as failure. Open the failing shard's job and its artifact;
reports are not merged.

`--shard` covers the root suite only; combining it with `--workspace` is
rejected. Change the shard count in both the matrix and the inventory check's
`--total`.

Before rebalancing, measured in November 2026 (#2102; five runs each, 446 tests, PHP 8.5,
Playwright 1.64.1, `ubuntu-latest` = ubuntu-26.04, all caches warm):

| Median (range)           | Sequential (1 job) | 4 shards         |
| ------------------------ | ------------------ | ---------------- |
| Workflow elapsed         | 42.8 (34.6–54.3)   | 20.9 (20.3–22.5) |
| Test step, slowest job   | 41.7 (33.7–53.1)   | 19.7 (18.9–21.4) |
| Runner minutes, all jobs | 43 (35–55)         | 65 (58–69)       |

Sharding halves the wait for a result and costs about 50% more runner
minutes: each shard repeats ~3 minutes of setup (caches, Docker images,
wp-env start). The shards are uneven: shard 4 takes 16–18 min of test time,
shard 2 only 4–6 min, so the slowest shard sets the elapsed time. Flaky
retries came from the block-docs examples spec (`wp.apiFetch is not a
function` right after login), which also flaked in sequential runs; see
[Calling `wp.apiFetch` from a spec](#calling-wpapifetch-from-a-spec) for the
cause and fix (#2152).

### Rebalancing shards

Both CI suites keep four isolated shards, but which spec files run in which
shard comes from recorded durations rather than Playwright's file-count
split (#2224). `scripts/shard-assignment.mjs` is the single assignment path;
the lifecycle runner and both inventory checks use it.

**Assignment rules.**

- The unit is a whole spec file, so file-level hooks and `describe.serial`
  groups stay together. Splitting a large spec is out of scope.
- The suite is listed without WordPress (the root config for E2E, each
  workspace's own `test:api` script for API). Files are sorted by weight,
  longest first, and each goes to the currently lightest shard. Ties keep
  discovery order and go to the lowest-numbered shard, so the same inventory
  and timing data always give the same assignment.
- API files of all workspaces are balanced together, so one slow workspace
  doesn't load a single shard. Inside a shard, workspaces run in root
  `package.json` order and files in discovery order.
- Weights are the checked-in median seconds per file in
  `scripts/shard-timings/e2e.json` and `scripts/shard-timings/api.json`, keyed
  by path from the repository root. They are never fetched during a run.
- A new or renamed file without an entry weighs the median of the recorded
  files. Entries without a file are reported as stale and ignored. Both
  appear in the shard job log and the inventory job log.
- Each shard runs its files through Playwright's `--test-list`, which matches
  exact rootDir-relative paths and is AND-ed with the workspace script's own
  path argument and any forwarded `--grep` or file filter. Passing your own
  `--test-list` together with `--shard` is rejected.

**When to refresh.** Refresh after adding or removing slow specs, or when a
shard's test time drifts more than a few minutes from the others in the
`report` output. Pick at least three recent successful runs of `main` (or
`workflow_dispatch` runs) whose artifacts haven't expired (seven days):

```bash
gh run list --workflow=e2e.yml --branch=main --status=success --limit=5
node scripts/shard-timings.mjs refresh --suite=e2e --run=<id> --run=<id> --run=<id>
node scripts/shard-timings.mjs refresh --suite=api --run=<id> --run=<id> --run=<id>
node scripts/check-e2e-shards.mjs --total=4
node scripts/check-api-shards.mjs --total=4
```

`refresh` downloads each run's shard reports (latest attempt per shard) with
`gh`. A file's duration runs from its first test start to its last test end.
Only clean samples count, meaning every test ran once and passed or was
skipped; samples with retries, failures or tests that never ran are reported
per run and counted as `excluded`. A file that was never clean keeps the
median of its excluded samples with `samples: 0`. The known flaky
`EventSignupHookBridge` spec is one of these. Review the timing diff and the
check output (estimated minutes per shard) in the PR that refreshes them.

**Measuring a change.** Dispatch the baseline and the candidate together and
in alternation, at least three of each per suite, so both see the same runner
image and caches. Then compare them:

```bash
gh workflow run e2e.yml --ref <baseline-branch>; gh workflow run e2e.yml --ref <candidate-branch>
node scripts/shard-timings.mjs report --suite=e2e --label=Before --run=<id> …
node scripts/shard-timings.mjs report --suite=e2e --label=After --run=<id> …
```

`report` gives, per run and as medians with ranges, the workflow elapsed
time from first job start to last job end (queue delay excluded), each
shard's test time (Playwright's duration for E2E, the sum of the workspace
test phases for API), the fastest-to-slowest gap, runner minutes over all
jobs, and flaky and failed tests. Keep failed runs in the table and say why
any run is excluded.

**Results (#2224).** Measured on 2026-11-09 with interleaved
`workflow_dispatch` runs of a baseline branch (`main` plus a manual trigger)
and the balanced branch: PHP 8.5, Playwright 1.65, `ubuntu-latest`, two CI
retries, warm caches. There were three runs per side for E2E and six for API.
All runs were dispatched together, so the elapsed times include waits for a
free runner. Compare the critical path instead: the inventory job plus the
slowest shard job plus the status job. Medians (range), in minutes:

| E2E (465 tests)           | Before           | Balanced         |
| ------------------------- | ---------------- | ---------------- |
| Slowest shard, test time  | 14.4 (13.4–16.3) | 11.5 (11.2–11.9) |
| Fastest shard, test time  | 4.4 (4.3–6.1)    | 10.6 (9.1–10.6)  |
| Fastest-to-slowest gap    | 10.1 (9.1–10.1)  | 1.3 (0.6–2.3)    |
| Critical path (jobs)      | 19.7 (18.6–21.3) | 16.6 (16.0–17.1) |
| Runner minutes, all jobs  | 56.8 (56.2–60.3) | 61.7 (60.2–63.1) |
| Flaky / failed tests, sum | 1 / 0            | 0 / 0            |

| API (1328 tests)          | Before           | Balanced         |
| ------------------------- | ---------------- | ---------------- |
| Slowest shard, test time  | 16.7 (13.6–18.9) | 14.9 (13.4–15.5) |
| Fastest shard, test time  | 9.7 (8.2–11.9)   | 11.4 (9.0–13.7)  |
| Fastest-to-slowest gap    | 7.3 (1.9–9.5)    | 3.0 (1.3–5.7)    |
| Critical path (jobs)      | 22.0 (19.2–26.2) | 21.2 (19.5–22.0) |
| Runner minutes, all jobs  | 69.7 (62.4–82.9) | 74.5 (61.0–77.9) |
| Flaky / failed tests, sum | 9 / 2            | 7 / 4            |

Balancing evens out the shards and shortens the slowest one, but each suite
used about 7–9% more runner minutes. Almost all of the extra time is test
time, spread over many mid-sized spec files with no link to their position in
a shard. It may come from leftover site state of other specs that now share a
shard, or from runner variance: the last API pair used fewer minutes balanced
than before. The trade-off was accepted on #2224. All runs are kept:

- Before, E2E: 42605626819, 42605643357, 42605659535. API: 42605635108,
  42605651488, 42605667217, 42610832048, 42610839519 (failed: the known
  `MetaDeliveryQueue` "overlapping workers" flake), 42615470886.
- Balanced, E2E: 42605631176, 42605647373, 42605663460. API: 42605639382,
  42605654889, 42605671284, 42610836026, 42610843986, 42615475918. The first
  three failed every attempt of `PaymentHistoryReconciliation`'s findings
  filter test, an order dependency that balancing exposed: another spec's
  canceled payment entered its exact-set check. The test now compares only its
  own payments. 42610836026 failed on the same `MetaDeliveryQueue` flake.

The assignment's estimate (sum of file spans) is below a shard's real test
time. It leaves out per-workspace start-up (API) and gaps between files, and
it adds the same amount to every shard, so it doesn't change the balance.

## Package script conventions

Workspaces expose only the scripts supported by their tests:

- Define `test:js` when the workspace has a JavaScript suite.
- Define `test:php` and chain it from `test` only when a PHP suite exists.
- Define `test:api` only when API specs exist.
- Define `test:e2e` only when workspace E2E specs exist.
- Keep `test:api` and `test:e2e` out of plain `npm test`; both require live
  WordPress and remain opt-in.

The root lifecycle validates workspace names against the root `package.json`,
which is the authoritative workspace list.

## Specialized workflows

### Resetting the demo site

`npm run demo:reset -- --acknowledge-reset` recreates the regular Docker
Compose site (`compose.yml`, port 8080) as a clean demo installation:

| Setting           | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| Site title        | Fair Events Plugins: Demo                                      |
| Administrator     | `admin` / `password`                                           |
| Site & admin mail | marcin.wosinek@gmail.com                                       |
| Languages         | English (US, active) and Spanish (`es_ES` core and themes)     |
| Plugins           | All mounted project plugins available; only Fair Events active |
| Content           | None: sample post, page, privacy page and comment removed      |
| Permalinks        | `/%postname%/`                                                 |

**It is destructive.** It removes this checkout's Compose containers and its
two data volumes, `<project>_wordpress` and `<project>_db` (the project is the
checkout's directory name, e.g. `fair-event-plugins`), so all posts, users,
uploads, installed themes/plugins/languages, options and `wp-config.php` go.
Repository files, images, other Compose projects, wp-env instances and every
other volume are kept; it never prunes. Without `--acknowledge-reset` it
exits with status 2 and changes nothing.

Prerequisites:

- Docker with Compose v2, on a local engine (a remote `DOCKER_HOST` or
  Docker context is refused).
- `npm install`, `npm run build -w fair-events` and `npm run composer:install`,
  so Fair Events can be activated. Build any other plugin you will activate.
- Ports 8080, 8081 and 3306 free. Another checkout's running Compose stack is
  reported by name; stop it there with `docker compose stop` first.
- Network access to `api.wordpress.org` and `downloads.wordpress.org` for the
  Spanish language packs.

Before deleting anything the script checks those prerequisites, that
`compose.yml` mounts the two named volumes, not bind mounts or external
volumes, and that both volumes carry this project's Compose labels. It then
starts the stack, waits (bounded) for the database, the WordPress files and
HTTP, installs, and verifies the settings above, the admin login over HTTP
and that the mounted plugins are discoverable. Any failure names the stage
and exits non-zero; status 2 means nothing was changed, status 1 means the
site is incomplete. Fix the cause and run the command again: every run
starts from empty volumes.

The site gets `scripts/demo/fair-demo-safety.php` as an MU plugin. It
suppresses all outgoing email, refuses outgoing HTTP requests except
WordPress.org and the site itself (so no payment provider or messaging
service is reached), and pauses cron until the reset has verified the
baseline. The credentials are public and for local use only.

Screenshot fixtures stay with their workflows: run the WordPress.org
screenshots below against the reset site. The Manage Event screenshots use
their own isolated wp-env instance and need no reset.

### WordPress.org screenshots

`fair-events/e2e/wordpress-org.spec.js` generates the plugin-directory images
at a consistent 1200×900 viewport. These scripts remain separate from the
behavioral E2E lifecycle because they use locale assets and the regular
development stack. Start from a clean site with
`npm run demo:reset -- --acknowledge-reset` ([Resetting the demo site](#resetting-the-demo-site)),
which also installs the Spanish core and theme language packs.

The spec accepts `SCREENSHOT_LOCALE` (`''` for English). Run both locale scripts
in the same session so their output does not drift:

```bash
npm run screenshots -w fair-events
npm run screenshots:es -w fair-events
```

Before a localized capture, install the relevant core and theme language packs
(already done on a reset site) and generate current translation/build
artifacts:

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

### Manage Event screenshots

`npm run screenshots:manage-event` captures every Manage Event tab of a
synthetic demo event on the isolated test site (`-- --reuse` for a running
instance). The demo data, safety checks, conditional-tab prerequisites,
output layout (`e2e/screenshots/output/manage-event/latest/`) and how to add
coverage for a new tab are documented in
[docs/manage-event-screenshots.md](./docs/manage-event-screenshots.md).

### Ad-hoc page screenshots

Use the headless Playwright helper for a one-off admin or public screenshot:

```bash
# npm run screenshot -- <path> <dimensions> <filename>
npm run screenshot -- "/wp-admin/admin.php?page=fair-finance-budgets" mobile budgets-mobile.png
```

Dimensions may be `desktop`, `tablet`, `mobile`, or `WIDTHxHEIGHT`. Options
include `--viewport`, `--wait <ms>`, `--wait-for <selector>`, `--no-login`,
`--upload <imgbb|github>`, `--issue <number>`, `--pr <number>`,
`--branch <name>`, and `--expiry <seconds>`. The file is written relative to
the current directory.

The helper defaults to the regular Docker development site at `:8080`. Set
`WP_SCREENSHOT_BASE_URL`, `WP_SCREENSHOT_USER`, and
`WP_SCREENSHOT_PASSWORD` in the gitignored `.env` when that site uses custom
login details. `WP_BASE_URL` and `WP_ADMIN_*` remain legacy fallbacks, but the
dedicated names avoid accidentally sharing browser-login credentials with API
tests that use a different environment and authentication model.

For PR embedding, add `--upload github`. It shells out to the
already-authenticated `gh` CLI (no new API key) and uploads the PNG as a
GitHub attachment after writing the local file:

- With no open PR for the checked-out branch, `--issue <n>` attaches it to a
  ticket comment marked with the branch and filename. A later upload of the
  same filename from the same branch supersedes that comment only.
- Once the branch has an open PR (or with `--pr <n>`), it attaches it to the
  PR and updates the description's `![<filename>](...)` reference.

`npm run screenshot:attach -- --pr <n> <file>...` attaches already-captured
PNGs to a PR in one go (fetching any missing before image from its issue
comment), and `npm run screenshot:verify -- --pr <n> [<filename>...]` checks
that every image the description references resolves. Both, and the upload
itself, exit non-zero on failure and never remove the local PNG. Attachment
logic lives in `scripts/pr-assets.mjs`, tested with a fake `gh` in
`scripts/__tests__/screenshot-attachments.test.mjs`. See
[COMMIT_GUIDE.md](./COMMIT_GUIDE.md) for the full responsive-UI PR workflow,
including replacement and failure recovery.

`--upload imgbb` (needs `IMGBB_API_KEY` in the gitignored repository `.env`)
remains available as an alternative public host; uploads expire after 30 days
by default, and imgbb accepts 60–15552000 seconds, while `0` disables expiry.

> **Public exposure, synthetic data only.** This repository is public, so
> both GitHub attachments and imgbb links are visible to anyone with the
> link, and GitHub caches them. Never upload participant names, email
> addresses, finance data, or other real data — capture from a local
> dev/demo instance only.

### Plugin Check reporting

`e2e/plugin-check.spec.js` installs the official Plugin Check plugin on the
wp-env tests instance and reports complete-scan error and warning counts for
each Fair Event plugin.

- Start the instance with `npm run test:e2e:setup` first.
- The first run needs network access to fetch Plugin Check.
- The suite reports findings but fails only when Plugin Check cannot run or
  its output cannot be parsed.
- Full scans are slow. Dependencies are excluded by Plugin Check defaults;
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
