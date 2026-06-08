# Deployment Setup Instructions

The deployment workflow uses a reusable workflow architecture:
- **`.github/workflows/deploy-to-environment.yml`** - Reusable workflow containing all deployment logic
- **`.github/workflows/php-ci.yml`** - Main workflow with two separate jobs (`deploy-acroyoga` and `deploy-fair-event-plugins`) that call the reusable workflow with hardcoded environment values

This approach eliminates matrix complexity while maintaining code reusability. It uses GitHub Environments to configure deployment targets.

## GitHub Environment Configuration

You need to configure two environments in GitHub:
- **Settings** → **Environments** → **New environment**

### Environment: `acroyoga-club.es`

**Variables:**
- `PLUGINS_TO_DEPLOY` = `all` (or comma-separated list: `fair-rsvp,fair-events,fair-payments-connector`)
- `SSH_HOST` - SSH hostname (e.g., `acroyoga-club.es`)
- `SSH_PORT` - SSH port (e.g., `22`)
- `SSH_USER` - SSH username
- `WORDPRESS_PLUGINS_PATH` - Path to WordPress plugins directory (e.g., `/var/www/html/wp-content/plugins`)

**Secrets:**
- `SSH_PRIVATE_KEY` - SSH private key for deployment

### Environment: `fair-event-plugins.com`

**Variables:**
- `PLUGINS_TO_DEPLOY` = `fair-platform` (or comma-separated list, or `all`)
- `SSH_HOST` - SSH hostname
- `SSH_PORT` - SSH port (e.g., `22`)
- `SSH_USER` - SSH username
- `WORDPRESS_PLUGINS_PATH` - Path to WordPress plugins directory (e.g., `/var/www/html/wp-content/plugins`)

**Secrets:**
- `SSH_PRIVATE_KEY` - SSH private key for deployment

## How It Works

### 1. Automatic Deployment (on main branch push)
   - CI runs and builds all plugins
   - After successful build, deploys to both environments in parallel
   - Each environment deploys only the plugins specified in `PLUGINS_TO_DEPLOY`

### 2. Manual Deployment (workflow_dispatch)
   - Go to **Actions** → **Continuous integration** → **Run workflow**
   - Select the branch you want to deploy from
   - Choose which environment to deploy to:
     - `acroyoga-club.es` - Deploy only to acroyoga-club.es
     - `fair-event-plugins.com` - Deploy only to fair-event-plugins.com
     - `both` - Deploy to both environments in parallel
   - The workflow will build the plugins from the selected branch and deploy them
   - Uses the same `PLUGINS_TO_DEPLOY` configuration from the environment

### 3. Plugin Selection
   - Set `PLUGINS_TO_DEPLOY` variable in each environment
   - Use `all` to deploy all plugins
   - Or provide comma-separated list: `fair-rsvp,fair-events,fair-payments-connector`
   - Spaces are automatically trimmed

### 4. Available Plugins
   - fair-rsvp
   - fair-events
   - fair-payments-connector
   - fair-calendar-button
   - fair-schedule
   - fair-timetable
   - fair-registration
   - fair-membership
   - fair-user-import
   - fair-team
   - fair-platform

## Workflow Architecture

### Reusable Workflow Pattern
The deployment logic is extracted into a reusable workflow that accepts an `environment` input parameter. This provides:
- **Code reusability** - Single source of truth for deployment steps
- **Clear separation** - Two explicit jobs with hardcoded environment names
- **No matrix complexity** - Each environment has its own dedicated job
- **Easy debugging** - Direct mapping between job name and environment

### Job Flow
1. **Main workflow** (`php-ci.yml`) triggers on push or manual dispatch
2. **Build job** runs first, creating plugin artifacts
3. **Deploy jobs** run in parallel (if both environments should deploy):
   - `deploy-acroyoga` → calls reusable workflow with `environment: acroyoga-club.es`
   - `deploy-fair-event-plugins` → calls reusable workflow with `environment: fair-event-plugins.com`
4. Each deploy job checks conditions (push to main OR manual trigger with matching environment)

## Benefits of This Approach

✅ **Reusable code** - All deployment logic in one maintainable workflow file
✅ **Environment-based** - Easy to add new deployment targets (add new job + call reusable workflow)
✅ **Explicit jobs** - Hardcoded environment values make the workflow easier to read
✅ **Flexible** - Each environment can deploy different plugins via environment variables
✅ **Parallel deployment** - Both environments deploy simultaneously when triggered
✅ **No matrix complexity** - Clear, straightforward job definitions
✅ **Manual deployment** - Deploy any branch to any environment on demand
✅ **Branch flexibility** - Test changes from feature branches before merging

## Migration from Old Workflows

The old workflows (`deploy-acroyoga.yml` and `deploy-fair-platform.yml`) have been removed. The new consolidated approach provides the same functionality with better maintainability.

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

1. Runs `npm run dist-archive` (unless `--skip-build`).
2. Extracts each plugin ZIP to `dist/extracted/`.
3. rsyncs each plugin with `-avz --delete` over SSH (2-attempt retry, same SSH keep-alive options as CI).
4. SSHes to the host and runs `wp plugin deactivate <plugin> && wp plugin activate <plugin>` for each deployed plugin (unless `--dry-run` or `--skip-reactivate`).

Each deployed plugin gets a `.deploy-version` file (written into the extracted plugin before rsync) containing `git describe --always --tags --dirty` and a UTC timestamp. A trailing `-dirty` suffix means the deploy included uncommitted local changes — useful when troubleshooting "what's actually on the server right now".

The CI deploy path remains the canonical/recommended flow — local deploy is an additional, opt-in escape hatch.

## Publishing to WordPress.org SVN

The `.github/workflows/publish-to-svn.yml` workflow publishes a tagged release of a plugin to its [WordPress.org SVN repository](https://plugins.svn.wordpress.org/). It replaces the previous laptop-only flow that ran `npm run svn:checkout` / `svn:tag:*` / `svn:copy` by hand.

### Trigger

Manual only — **Actions → Publish to WordPress.org SVN → Run workflow**. Inputs:

- `plugin` — one of `fair-events`, `fair-audience`, `fair-timetable`.
- `version` — semver string (e.g. `1.2.3`). Validated against `^[0-9]+\.[0-9]+\.[0-9]+$`; the workflow fails fast on anything else.
- `dry_run` — defaults to `true`. When `true`, the workflow performs every step except the final `svn ci` and prints `svn status` so you can confirm the staged changes.

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

### Optional hardening

The commit step can be gated behind a dedicated GitHub Environment (e.g. `wordpress.org`) with required reviewers. Add `environment: wordpress.org` to the `publish` job and move the two secrets onto that environment if you want a second-pair-of-eyes prompt before the live commit.

