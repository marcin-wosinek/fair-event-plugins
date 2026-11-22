# Deployment

This guide covers deployment configuration, routine operations, monitoring and
WordPress.org publishing. Release versioning and tagging are documented in
[RELEASES.md](./RELEASES.md). One-time upgrade instructions from past releases
are kept in [DEPLOYMENT_HISTORY.md](./DEPLOYMENT_HISTORY.md).

The deployment workflow uses a reusable workflow architecture:

- **`.github/workflows/continuous-integration.yml`** - Builds all plugin ZIPs, runs tests, and creates the Changesets release PR / GitHub release. Both release jobs (`release`, which opens the release PR and pushes plugin tags, and `general-release`, which publishes the built ZIPs) need `build`, `validation`, `js-tests`, `tooling-tests`, the PHPUnit matrix (`php-tests`) and the minimum-PHP checks (`php-runtime`). A failed, cancelled or skipped dependency blocks both. `build` owns packaging: it compiles, stamps and zips the plugins, and verifies the ZIP contents before uploading the `plugins` artifact. **Repository validation** (`validation`) owns the source-level documentation and policy checks. It and the test jobs run independently of `build`, so its `plugins` artifact still uploads when a validation or test fails; see [TESTING.md § Repository validation](./TESTING.md#repository-validation), [TESTING.md § Unit and component tests](./TESTING.md#unit-and-component-tests) and [TESTING.md § PHP versions](./TESTING.md#php-versions)
- **`.github/workflows/integration-tests.yml`** - Runs the API and E2E suites; it is not a dependency of either release job, so restructuring it never bypasses or adds a publishing gate. Its `Prepare integration build` job owns the `integration-build-attempt-N` artifact (each runtime plugin's `build/`, `block-docs/` and production `vendor/` plus a manifest, kept 30 days), which only that run's shards consume. It never replaces the release `plugins` artifact, which `build` stamps and zips; see [TESTING.md § Integration test workflow](./TESTING.md#integration-test-workflow)
- **`.github/workflows/deploy-from-release.yml`** - Triggered when a `build-X.Y.Z` release is published (or manually via workflow_dispatch); has one job per target site that calls the reusable workflow
- **`.github/workflows/deploy-to-environment.yml`** - Reusable workflow containing all deployment logic

It uses GitHub Environments to configure deployment targets.

## GitHub Environment Configuration

You need to configure environments in GitHub:

- **Settings** → **Environments** → **New environment**

### Required variables (all environments)

- `PLUGINS_TO_DEPLOY` — `all` or a comma-separated list (e.g. `fair-events,fair-payments-connector`)
- `SSH_HOST` — SSH hostname
- `SSH_PORT` — SSH port (e.g. `22`)
- `SSH_KNOWN_HOSTS` — SSH known hosts entry for the server
- `SSH_USER` — SSH username
- `WORDPRESS_PLUGINS_PATH` — absolute path to the WordPress plugins directory

### Optional variable: `AUTO_DEPLOY_ON_RELEASE`

Set `AUTO_DEPLOY_ON_RELEASE=true` on any environment that should receive automatic deploys when a clean `build-X.Y.Z` release is published.

**Currently opted in:** `fair-event-plugins.com`

Leave this variable unset (or set it to any value other than `true`) on client sites to require a manual `workflow_dispatch` for every deploy. Manual dispatch always works regardless of this setting.

### Secrets (all environments)

- `SSH_PRIVATE_KEY` — SSH private key for deployment

### Per-environment notes

**`acroyoga-club.es`** — `PLUGINS_TO_DEPLOY=all`. No `AUTO_DEPLOY_ON_RELEASE` — deploys on manual dispatch only.

**`fair-event-plugins.com`** — `PLUGINS_TO_DEPLOY=fair-platform` (or `all`). `AUTO_DEPLOY_ON_RELEASE=true`.

**`lamutable.es`**, **`fusion-dance.es`**, **`acro-agenda.es`**, **`fusion-circus.com`** — set `PLUGINS_TO_DEPLOY` as appropriate. No `AUTO_DEPLOY_ON_RELEASE` — deploys on manual dispatch only.

**`circus-it.eu`** — `PLUGINS_TO_DEPLOY=fair-audience,fair-form`. No `AUTO_DEPLOY_ON_RELEASE` — deploys on manual dispatch only.

## How It Works

### 1. Automatic Deployment (on release publish)

- Merging the Changesets release PR publishes a `build-X.Y.Z` GitHub release
  (see [RELEASES.md](./RELEASES.md))
- `deploy-from-release.yml` runs; environments with
  `AUTO_DEPLOY_ON_RELEASE=true` deploy automatically, in parallel
- Each environment deploys only the plugins specified in `PLUGINS_TO_DEPLOY`

### 2. Manual Deployment (workflow_dispatch)

- Go to **Actions** → **Deploy from release** → **Run workflow**
- Enter the release tag to deploy (e.g. `build-1.0.0`) and tick the checkbox
  for each target site
- Uses the same `PLUGINS_TO_DEPLOY` configuration from each environment

### 3. Plugin Selection

- Set `PLUGINS_TO_DEPLOY` variable in each environment
- Use `all` to deploy every deployable plugin, or a comma-separated list
  (e.g. `fair-events,fair-payments-connector`); spaces are trimmed
- The authoritative `all` list lives in
  `.github/workflows/deploy-to-environment.yml` (the `PLUGINS=` default)

## Workflow Architecture

`deploy-from-release.yml` has one explicit job per target site
(`deploy-acroyoga`, `deploy-fair-event-plugins`, `deploy-lamutable`, …), each
calling the reusable `deploy-to-environment.yml` with its `environment` input.
Adding a new target = add a GitHub Environment + one job that calls the
reusable workflow.

## Local Deploy (skips CI)

For fast iteration or hotfixes you can build and deploy from your machine, bypassing the GitHub release+deploy pipeline. **This skips all CI checks (lint, tests)** — run them yourself before deploying.

### Setup

1. Copy the template and fill in real values:

    ```bash
    cp .deploy/example.env .deploy/staging.env
    $EDITOR .deploy/staging.env
    ```

    Required keys: `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `WORDPRESS_PLUGINS_PATH`, `PLUGINS_TO_DEPLOY`. Optional: `SSH_KEY_PATH` (defaults to ssh-agent identity).

2. Ensure your SSH key is loaded (`ssh-add -l`) and the host is in `~/.ssh/known_hosts`.

`.deploy/*.env` files are gitignored — only `.deploy/example.env` is committed.

### Commands

```bash
# Build + deploy to staging
npm run deploy:local -- --env=staging

# Dry-run (rsync --dry-run, no WP-CLI reactivation)
npm run deploy:local:dry -- --env=staging

# Deploy a subset (overrides PLUGINS_TO_DEPLOY)
npm run deploy:local -- --env=staging --plugins=fair-events,fair-payments-connector

# Reuse existing dist/*.zip; do not run dist-archive
npm run deploy:local -- --env=staging --skip-build

# Deploy without WP-CLI deactivate/activate
npm run deploy:local -- --env=staging --skip-reactivate
```

### What it does

Mirrors `.github/workflows/deploy-to-environment.yml`:

1. Runs `npm run dist-archive` (unless `--skip-build`), with every selected plugin's `Version:` header temporarily stamped with the local version below. The plugins come from [plugin discovery](./RELEASES.md#-plugin-discovery), so a selected name that isn't a plugin workspace fails before building, and the headers are restored afterwards even when packaging fails. `--plugins=all` still means the fixed deployable set in `ALL_PLUGINS` (`scripts/deploy-local.js`).
2. Extracts each plugin ZIP to `dist/extracted/`.
3. rsyncs each plugin with `-avz --delete` over SSH (2-attempt retry, same SSH keep-alive options as CI).
4. SSHes to the host and runs `wp plugin deactivate <plugin> && wp plugin activate <plugin>` for each deployed plugin (unless `--dry-run` or `--skip-reactivate`).

Each deployed plugin gets a `.deploy-version` file (written into the extracted plugin before rsync) containing `git describe --always --tags --dirty` (the same value stamped into the headers; unlike CI it is not per-plugin) and a UTC timestamp. A trailing `-dirty` suffix means the deploy included uncommitted local changes — useful when troubleshooting "what's actually on the server right now".

The CI deploy path remains the canonical/recommended flow — local deploy is an additional, opt-in escape hatch.

## OAuth proxy monitoring (fair-event-plugins.com)

Every connected site refreshes its Mollie access token, which expires
hourly, through the Mollie OAuth proxy that Fair Platform runs on
fair-event-plugins.com. If the proxy stops answering, online payments stop
on every connected site at once, while those sites still show Mollie as
connected.

### Health signal

`GET https://fair-event-plugins.com/wp-json/fair-platform/v1/health` is
public and needs no authentication. It is read-only, makes no outbound
request, and sends `Cache-Control: no-store`.

| Answer                                                               | Meaning                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `200` `{"service":"fair-platform-oauth-proxy","status":"ok"}`        | Fair Platform started, Mollie credentials are set, and the Mollie library is loaded.       |
| `503` `{"service":"fair-platform-oauth-proxy","status":"unhealthy"}` | Fair Platform is running, but credentials are missing or empty, or the library is missing. |
| `404` `rest_no_route`, a redirect, or HTML                           | Fair Platform is paused or inactive, or the REST API isn't reachable. Treat it as down.    |

The answer never includes a cause, credentials, versions or connected-site
details. It also doesn't check that Mollie itself is reachable.

**Caching:** exclude `/wp-json/fair-platform/v1/health` and `/oauth/*` from
any page cache or CDN on fair-event-plugins.com. A cached `200` would hide
an outage from the deploy check and the monitor.

### Post-deploy check

After every deploy to the `fair-event-plugins.com` environment (automatic on
release and manual dispatch, whichever plugins were deployed),
`deploy-to-environment.yml` checks out `scripts/` from the deployed release
tag and runs `scripts/verify-oauth-proxy.mjs`. The script:

1. requires the healthy `200` answer above from the health route, and
2. sends an empty `POST /oauth/refresh` and requires the proxy's own `400`
   JSON `Missing refresh_token`. It never sends a token, real or dummy, so
   the proxy answers before contacting Mollie.

It never follows redirects. It retries up to 5 times, 15 s apart, with a
15 s timeout per request. If the last attempt still fails, the deploy job
fails, with the reason in the log and the job summary. The plugins are
already on the server at that point. The failure means the proxy is down,
not that the files weren't deployed. Releases older than the check have no
script; for those the job only warns, so check the health URL by hand.

Run it by hand against any site:

```bash
node scripts/verify-oauth-proxy.mjs --url=https://fair-event-plugins.com
# Options: --attempts=5 --delay=10000 --timeout=15000 (milliseconds)
```

| Failure says                                 | Likely cause and fix                                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| health route is missing, redirected, or HTML | Fair Platform is paused by an outdated shared library in another Fair plugin (update every Fair plugin on the site; see [PHP_PATTERNS.md § Shared Package](./PHP_PATTERNS.md#shared-package-fair-events-shared)), or it is inactive (`wp plugin list`). |
| health reports unhealthy (HTTP 503)          | Set `MOLLIE_CLIENT_ID` and `MOLLIE_CLIENT_SECRET` in `wp-config.php`, and check that the deployed plugin has its `vendor/` directory.                                                                                                                   |
| refresh answered HTML or a redirect          | Health passed but `/oauth/*` doesn't reach the plugin: flush rewrite rules (`wp rewrite flush`) and check the permalink settings.                                                                                                                       |
| timed out / request failed                   | The site or its host is down or blocking the GitHub runner.                                                                                                                                                                                             |

### External uptime monitor

Configure a hosted Better Stack monitor to watch the health URL, independent
of GitHub Actions schedules:

- URL: `https://fair-event-plugins.com/wp-json/fair-platform/v1/health`
- Check every minute; HTTP status must be `200` and the body must contain
  `"status":"ok"`; don't follow redirects.
- Alert after about 3 minutes of consecutive failures, so a sustained
  outage is reported within about 5 minutes. Send a recovery notice too.
- Alerts go by email to the maintainer (@marcin-wosinek). The address is
  confirmed in the Better Stack account during setup and isn't recorded
  here.

Before treating the monitor as operational, confirm delivery once: point a
temporary second monitor at a URL that fails the same way (for example the
health URL with a body check that can't match), wait for the alert and the
recovery email after fixing it, then delete it. Don't take the production
proxy down to test.

### Error tracking

Fair Platform reports failures in the proxy's Mollie OAuth flows
(authorize, callback, profile selection and refresh) to Sentry, so a broken
flow surfaces even while the health check passes. Reporting is off until
`wp-config.php` on fair-event-plugins.com defines the project's DSN:

```php
define( 'FAIR_PLATFORM_SENTRY_DSN', 'https://<key>@<org>.ingest.sentry.io/<project>' );
```

Keep the DSN out of the repository. Events carry the release
`fair-platform@<version>` and the site's `wp_get_environment_type()`.

**What is reported** (`fair-platform/src/Monitoring/`):

| Category              | When                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `exception`           | An exception or error escapes a flow. It is rethrown, so the request fails as before.                              |
| `php_error`           | A PHP warning or notice during a flow, within the site's `error_reporting()`. Deprecations aren't.                 |
| `fatal_error`         | A PHP fatal error ends a flow.                                                                                     |
| `transport_failed`    | A request to Mollie fails without an answer (step: `token_exchange`, `organization`, `profiles`, `token_refresh`). |
| `http_error`          | Mollie answers with an unexpected status, for example `invalid_grant` for a revoked refresh token.                 |
| `invalid_response`    | Mollie answers `200` without the expected tokens.                                                                  |
| `authorization_error` | Mollie returns an authorization error other than a cancellation, for a known state.                                |

Not reported: missing or invalid parameters, an expired or unknown state or
session, a cancelled authorization (`access_denied`), the post-deploy
check's empty refresh `POST`, and the Instagram flows.

**What an event contains:** fixed tags only (`flow`, `category`, `step`,
`http_status`, an OAuth error code from RFC 6749 or `other`, and the PHP
error type), exception class names, and stack locations as plugin- or
WordPress-relative file, line and function name. Exception and PHP error
messages are replaced, and request data, headers, cookies, users,
breadcrumbs, stack arguments, variables, source lines and server names are
never sent. Every event is rebuilt from that list just before it leaves
(`before_send`), and `SafeEventTest`/`OAuthErrorReporterTest` prove that
secret markers in each of those places don't reach the payload.

The SDK only runs while one of these flows handles a request: it has no
global hub, no default integrations and no error handlers of its own.
Reporting never changes a flow's answer. A tracker that is down or slow
costs at most about 2 s on a failing request: after one failed send, the
request sends nothing more. A request sends at most 5 events, and each
kind of event (flow, category, step) is sent at most 10 times an hour, so
the public endpoints can't be used to flood the project.

**Alerts:** in the Sentry project, add an issue alert for new issues and
for regressions, sent by email to the maintainer (@marcin-wosinek). Confirm
the address in the Sentry account during setup; it isn't recorded here.

**Delivery test,** after setting the DSN: send one refresh with a dummy
token, which Mollie rejects without effect on any connection:

```bash
curl -s -X POST -d refresh_token=delivery-test https://fair-event-plugins.com/oauth/refresh
```

The answer is Mollie's error (expect `400` with `invalid_grant`). Sentry
then shows `Mollie OAuth refresh: http_error (token_refresh)` with the
matching `http_status` and `oauth_error` tags, and the alert email
arrives. Check that the event shows
none of the request: no token, URL query, headers or caller IP address. Then
resolve the issue.

**Privacy:** Sentry processes these events for fair-event-plugins.com. They
contain no personal or payment data, but list Sentry as a processor in the
site's privacy policy before enabling the DSN.

## Publishing to WordPress.org SVN

The `.github/workflows/publish-to-svn.yml` workflow publishes a tagged release of a plugin to its [WordPress.org SVN repository](https://plugins.svn.wordpress.org/). It replaces the previous laptop-only flow that ran `npm run svn:checkout` / `svn:tag:*` / `svn:copy` by hand.

### Trigger

Manual only — **Actions → Publish to WordPress.org SVN → Run workflow**. Inputs:

- `plugin` — one of `fair-events`, `fair-audience`, `fair-timetable`, `fair-payments-connector`, `fair-calendar-button`.
- `version` — semver string (e.g. `1.2.3`). Validated against `^[0-9]+\.[0-9]+\.[0-9]+$`.
- `dry_run` — defaults to `true`. When `true`, the workflow performs every step except the final `svn ci` and prints `svn status` so you can confirm the staged changes.

The first step validates both values, before checkout or any other side effect, and fails on anything else. Later steps read the inputs from environment variables, never from expressions inside a script, so a supplied value is never run as shell syntax.

The workflow checks out the matching git tag (`<plugin>@<version>`) so the build matches the released commit, not whatever is on `main`.

### Required secrets

Configure these as **repository secrets** (Settings → Secrets and variables → Actions):

- `WPORG_SVN_USERNAME` — WordPress.org committer username.
- `WPORG_SVN_PASSWORD` — committer password (or app password, if configured on wordpress.org).

The password is only exposed as an env var on the `svn ci` step; it is never passed through workflow `with:` inputs.

### Typical flow

1. Merge a Changesets release PR. This produces a git tag like `fair-events@1.2.3` (see [RELEASES.md](./RELEASES.md)).
2. Run the workflow with `plugin=fair-events`, `version=1.2.3`, `dry_run=true`.
3. Inspect the `svn status` output in the job log. Confirm the new `tags/<version>/` directory and any updated `trunk/` / `assets/` files look right.
4. Re-run with `dry_run=false` to commit to wordpress.org.

`assets/` carries both the default screenshots (`screenshot-N.png`) and any
locale-suffixed sets (e.g. `screenshot-N-es.png` for Spanish, per
[TESTING.md](./TESTING.md)). The "Refresh assets" step copies everything in
`assets/` as a flat glob, so a locale set needs no workflow change — but the
default and locale sets must be re-captured together whenever the plugin UI
changes, or the listing's localized gallery drifts out of sync with the
English one.

### Optional hardening

The commit step can be gated behind a dedicated GitHub Environment (e.g. `wordpress.org`) with required reviewers. Add `environment: wordpress.org` to the `publish` job and move the two secrets onto that environment if you want a second-pair-of-eyes prompt before the live commit.
