# Deployment Setup Instructions

The deployment workflow uses a reusable workflow architecture:

- **`.github/workflows/continuous-integration.yml`** - Builds all plugin ZIPs, runs tests, and creates the Changesets release PR / GitHub release. The release jobs wait for the build, the PHPUnit matrix (`php-tests`) and the minimum-PHP checks (`php-runtime`); see [TESTING.md § PHP versions](./TESTING.md#php-versions)
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

1. Runs `npm run dist-archive` (unless `--skip-build`).
2. Extracts each plugin ZIP to `dist/extracted/`.
3. rsyncs each plugin with `-avz --delete` over SSH (2-attempt retry, same SSH keep-alive options as CI).
4. SSHes to the host and runs `wp plugin deactivate <plugin> && wp plugin activate <plugin>` for each deployed plugin (unless `--dry-run` or `--skip-reactivate`).

Each deployed plugin gets a `.deploy-version` file (written into the extracted plugin before rsync) containing `git describe --always --tags --dirty` and a UTC timestamp. A trailing `-dirty` suffix means the deploy included uncommitted local changes — useful when troubleshooting "what's actually on the server right now".

The CI deploy path remains the canonical/recommended flow — local deploy is an additional, opt-in escape hatch.

## Upgrade notes: event gallery removal (#1675)

Upgrading to fair-events DB version `3.36.0` and fair-audience DB version
`1.44.0` permanently deletes the retired event gallery's data on the first
request after deploy:

- tables `{prefix}fair_events_event_photos`, `{prefix}fair_events_photo_likes`
  and `{prefix}fair_audience_gallery_access_keys`;
- the `fair_events_bulk_upload_event` user meta;
- the `galleries` key of `fair_events_experimental_features`, and of
  `fair_audience_experimental_features` (its value moves to the new
  `photos` key).

Media attachments and files, `{prefix}fair_audience_photo_participants`
(photo authors/tags), events and participants are not touched. A site that
set `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_GALLERIES` in `wp-config.php` must
rename it to `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_PHOTOS`.

**Before deploying to production,** back up the database, at least the
affected tables and options:

```bash
wp db export pre-gallery-removal.sql --tables=$(wp db tables '*fair_events_event_photos' '*fair_events_photo_likes' '*fair_audience_gallery_access_keys' '*options' '*usermeta' --format=csv)
```

The cleanup is retried on every request until it succeeds, and each plugin
records its new DB version only after its own cleanup succeeded. If it keeps
failing, check the PHP error log for the `DROP TABLE` error.

**To roll back** (redeploy the previous plugin versions), restore the backup
with `wp db import pre-gallery-removal.sql`, then set
`fair_events_db_version` back to `3.35.0` and `fair_audience_db_version` back
to `1.43.0` if the restored options do not already hold those values, and
flush permalinks (`wp rewrite flush`) so `/event-gallery/{id}` resolves again.

## Upgrade notes: photo authors, tags and upload page removal (#1689)

Upgrading to fair-audience DB version `1.46.0` permanently deletes the photo
attribution data on the first request after deploy:

- the table `{prefix}fair_audience_photo_participants` (who took and who
  appears in each photo);
- the `fair_audience_bulk_upload_author` and `fair_audience_bulk_upload_tags`
  user meta;
- the `photos` key of `fair_audience_experimental_features`.

Media attachments and their files, posts that use them, events and
participants are not touched. The Photos bundle no longer exists, so a
`FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_PHOTOS` constant in `wp-config.php` has
no effect any more and can be removed. Old "Upload photos" links
(`?photo_upload=1`) answer 410 Gone, and a `{photo_upload_url}` link in a saved
message is left out when it is sent.

**Update fair-audience-experimental first**, then fair-audience and
fair-form. That removes the old code that writes attribution before
fair-audience drops its table. Either order works without errors, but an
outdated companion keeps its media screen fields and Collaborators photo
column, which then read a missing table, until it is updated.

**Before deploying to production,** back up the database, at least the
affected tables and options:

```bash
wp db export pre-photo-removal.sql --tables=$(wp db tables '*fair_audience_photo_participants' '*options' '*usermeta' --format=csv)
```

The cleanup is retried on every request until it succeeds, and the new DB
version is recorded only after every step succeeded. If it keeps failing,
check the PHP error log for the `DROP TABLE` error.

**To roll back** (redeploy the previous plugin versions), restore the backup
with `wp db import pre-photo-removal.sql`, then set
`fair_audience_db_version` back to `1.45.0` if the restored options do not
already hold that value.

## Upgrade notes: Collaborators page removal (#1987)

Upgrading to fair-audience DB version `1.47.0` removes the `collaborators`
key of `fair_audience_experimental_features` on the first request after
deploy, keeping every other bundle choice. Nothing else is deleted:
participants, their collaborator roles on events, confirmation tokens and
mailing recipients stay as they were, and events keep managing
collaborators.

The Collaborators bundle no longer exists, so a
`FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_COLLABORATORS` constant in
`wp-config.php` has no effect any more and can be removed. The
`fair-audience-collaborators` admin page and the
`/fair-audience/v1/collaborators` REST route are gone; a bookmarked page gets
WordPress's standard "not allowed" answer. Old collaborator registration
links (`?collaborator_profile=1`) answer 410 Gone for both GET and POST,
whether or not fair-audience-experimental is active, and create no
participant, token or confirmation email.

Either update order works. Until fair-audience is updated, an outdated
companion still serves the page and form; once fair-audience is updated, its
410 answer takes over the registration links even before the companion is.

The cleanup is retried on every request until it succeeds. **To roll back**
(redeploy the previous plugin versions), set `fair_audience_db_version` back
to `1.46.0`; the bundle defaults to on, so no option needs restoring unless
it had been switched off.

## Upgrade notes: payment history storage (#2138)

> **Historical.** The stage 2–5 notes below (#2138–#2141) describe how to
> run the migration on `build-2.2.0`, the last release that contains it.
> Newer releases don't run on a site that hasn't finished it; see
> [the supported upgrade path](#upgrade-notes-supported-upgrade-path-after-the-payment-history-migration-2255).

Stage 2 of the payment history migration
([PAYMENT_HISTORY_MIGRATION.md § 8.7](./PAYMENT_HISTORY_MIGRATION.md#87-stage-2-storage-and-capabilities)).
Upgrading to fair-events DB version `3.49.0` adds, on the first request
after deploy:

- the empty table `{prefix}fair_events_signup_payment_links`;
- the nullable column `legacy_event_participant_id`, with a unique index,
  on `{prefix}fair_events_signups`.

No existing row changes and nothing is deleted. Ticket counts, capacity,
Statistics revenue, payments, retries and emails keep working from the same
data as before; the new storage stays empty until stage 3.

**Update order: Fair Payments Connector first, then Fair Events, then Fair
Audience.** Connector has no change in this stage, but keep it current so
the later stages start from a known version. Every order still works:

- Newer Fair Events with an older Fair Audience: everything works, but the
  stage 3 backfill refuses to start (`audience_incompatible`) until Fair
  Audience is updated. An older Fair Audience would count each backfilled
  participant a second time in capacity, so never start the backfill with
  one, and don't roll Fair Audience back below this release once the
  backfill has run.
- Older Fair Events with a newer Fair Audience: Fair Audience notices the
  missing capability and keeps its previous capacity query.

Minimum versions are those released with this change; see each plugin's
changelog for the version numbers.

**To roll back** (redeploy the previous plugin versions), nothing needs
restoring: the older code ignores the empty table and the null column. To
remove them as well, drop the table, then the index and column, and set
`fair_events_db_version` back to `3.48.0`:

```bash
wp db query "DROP TABLE IF EXISTS $(wp db prefix)fair_events_signup_payment_links"
wp db query "ALTER TABLE $(wp db prefix)fair_events_signups DROP INDEX idx_legacy_event_participant_id, DROP COLUMN legacy_event_participant_id"
wp option update fair_events_db_version 3.48.0
```

Only do this before stage 3 has run: afterwards the column holds the
backfill's provenance (see the stage 3 notes).

## Upgrade notes: payment history shadow writes (#2139)

First part of stage 3 of the payment history migration
([PAYMENT_HISTORY_MIGRATION.md § 8.8](./PAYMENT_HISTORY_MIGRATION.md#88-stage-3-shadow-writes)).
Upgrading to fair-events DB version `3.50.0` adds, on the first request
after deploy, the empty table `{prefix}fair_events_payment_shadow_work`,
and turns shadow writes on once Fair Audience is current too:

- every new payment attempt is also recorded in
  `{prefix}fair_events_signup_payment_links`;
- every new Fair Audience-only admission (Audience's purchase route, an
  organizer adding a participant) gets an Events purchase that follows it,
  marked with `legacy_event_participant_id`. These purchases appear in the
  Manage Event signups list, and their ticket counts in place of the
  participant, so ticket counts, capacity and Statistics stay the same.
  They send no email and don't change payments;
- the option `fair_events_payment_history_migration` records when this
  started (`shadow_writes`), and the cron
  `fair_events_payment_history_shadow_work` runs every fifteen minutes.

Payments, retries, emails, revenue and the Audience ledger keep working
from the same data as before.

**Update order: Fair Payments Connector first, then Fair Events, then Fair
Audience.** Shadow writes start only once both Fair Events and Fair
Audience are on this release. Until then nothing changes.

**Rolling back.** Before shadow writes have started, redeploy the previous
versions; nothing needs restoring. Once they have started, don't roll Fair
Audience back below this release, and don't roll Fair Events back below the
#2138 release: either would count every shadow purchase's activities or
admission a second time. Rolling Fair Events back to the #2138 release is
safe: it ignores the queue table and keeps skipping the relationships its
shadow purchases stand for. Those purchases stop following their
relationships until you upgrade again, when the sweep brings them back in
step. Don't drop
`legacy_event_participant_id` once shadow writes have run.

## Upgrade notes: payment history backfill (#2139)

Second part of stage 3 of the payment history migration
([PAYMENT_HISTORY_MIGRATION.md § 8.9](./PAYMENT_HISTORY_MIGRATION.md#89-stage-3-backfill-and-verification)).
Upgrading to fair-events DB version `3.51.0` adds, on the first request
after deploy, two empty tables:
`{prefix}fair_events_payment_history_findings` and
`{prefix}fair_events_payment_history_comparisons`. Nothing else changes, and
nothing runs, until an administrator starts the backfill.

**Readiness to start.** The backfill refuses to start while
`PaymentHistoryCompatibility::backfill_blockers()` lists anything: Fair
Payments Connector and Fair Audience must be on the shadow writes release or
later, and shadow writes must be on. It also needs a completed dry run over
the same records, and a confirmed database backup. From fair-events DB
version `3.52.0` (the reconciliation release, below), start and follow it
on **Fair Events → Payment history**. On the backfill release alone, use
WP-CLI:

```bash
# 1. Dry run: writes no purchase or link. Runs in the background; check it.
wp eval 'print_r( FairEvents\Services\PaymentHistoryBackfill::start_dry_run() );'
wp eval 'print_r( FairEvents\Services\PaymentHistoryBackfill::status() );'
# 2. Back up the tables below, then start.
wp eval 'print_r( FairEvents\Services\PaymentHistoryBackfill::start( array( "backup_confirmed" => true ) ) );'
```

**Back up before starting** (`wp db export --tables=…`):

- written by the backfill: `{prefix}fair_events_signups`,
  `{prefix}fair_events_tickets`, `{prefix}fair_events_ticket_activities`,
  `{prefix}fair_events_signup_payment_links`,
  `{prefix}fair_events_payment_history_findings`,
  `{prefix}fair_events_payment_history_comparisons`, and the option
  `fair_events_payment_history_migration`;
- read only, for reference: `{prefix}fair_audience_event_participants`,
  `{prefix}fair_audience_event_participant_options`,
  `{prefix}fair_audience_event_participant_transactions`,
  `{prefix}fair_audience_participants`, `{prefix}fair_payment_transactions`
  and `{prefix}fair_payment_line_items`.

The backfill runs in batches through WP-Cron and survives deploys and
failures: a failed batch is retried from the last record that succeeded,
with a growing delay, and the shadow work cron reschedules a run whose
batch was lost. If a blocker appears (Connector deactivated, Fair Audience
rolled back), the backfill pauses and continues once it clears.

The backfill creates confirmed Events purchases for historical Fair
Audience admissions (marked with `legacy_event_participant_id`, like shadow
purchases) and records payment links with `attribution = backfill`. Ticket
counts, capacity and Statistics stay the same; the purchases appear in the
Manage Event signups list. It changes no ledger row, relationship,
participant activity, transaction or existing link, and sends no email.

**Verification.** When it finishes, the option's `status` becomes
`verified` when the report has no blocking difference, or
`verification_failed` with the blockers. Shadow work still queued blocks
verification; run `PaymentHistoryBackfill::verify()` again once it clears.
Unresolved records are listed as findings and don't block. Payment
authority and the Statistics readers don't change in this release
(`ownership_cutover()` stays false).

**Rolling back.** Before stage 4 the Audience ledger is still
authoritative, so the previous plugin versions keep working: redeploying
the shadow writes release is safe, and it ignores the two new tables. Keep
Fair Audience on the shadow writes release or later, since an older one
would count backfilled admissions twice. To undo the backfill's data as
well, restore the tables exported above.

## Upgrade notes: payment history reconciliation (#2139)

Third part of stage 3 of the payment history migration
([PAYMENT_HISTORY_MIGRATION.md § 8.10](./PAYMENT_HISTORY_MIGRATION.md#810-stage-3-reconciliation)).
Upgrading to fair-events DB version `3.52.0` adds, on the first request
after deploy, one empty table: `{prefix}fair_events_payment_history_audit`.
Nothing runs on upgrade.

**What appears.** Administrators get **Fair Events → Payment history**
(`manage_options`), and the `fair-events/v1/payment-history` REST routes.
The page runs the dry run and the backfill described above, so the WP-CLI
commands are no longer needed, shows the verification report, and lists
the records the backfill couldn't link. For each one an administrator can
link the payment to purchases, split a shared payment, remove a link they
added, or mark the record reviewed. Every decision needs a note and is
recorded in the audit table.

**Readiness gates.** Same as the backfill: nothing starts while
`backfill_blockers()` lists anything, without a completed dry run over the
same records, or without a confirmed backup (the page asks for it and names
the tables). Reconciliation needs Fair Payments Connector active to link;
reviewing works without it. A decision re-runs verification once the
backfill has finished, so the migration's status may show `running` for a
few batches afterwards. Payment authority and the Statistics readers still
don't change (`ownership_cutover()` stays false).

**Back up** `{prefix}fair_events_payment_history_audit` together with the
backfill tables listed above: reconciliation writes
`{prefix}fair_events_signup_payment_links` (reconciled links only),
`{prefix}fair_events_payment_history_findings` (statuses),
`{prefix}fair_events_payment_history_comparisons` and
`{prefix}fair_events_signups` (the amount of migrated purchases).

**Recovery.** A wrong link is removed on the page, which keeps both
decisions in the audit. Rolling back to the backfill release is safe: it
ignores the audit table, keeps reconciled links (they're inert before stage
4), and a re-run of its backfill would report the reconciled transactions
again, since it doesn't know about decisions. Restore the backed-up tables
to undo the reconciliation entirely.

## Upgrade notes: payment history cutover (#2140)

Stage 4 of the payment history migration
([PAYMENT_HISTORY_MIGRATION.md § 8.11–8.13](./PAYMENT_HISTORY_MIGRATION.md#813-stage-4-activation)).
No schema change and nothing runs on upgrade. The release adds the Events
purchase lifecycle (get-tickets and Fair Audience's routes) and the switch
that turns it on. Until an administrator switches, payments, emails, the
Audience ledger and Statistics work exactly as after stage 3.

**Update order: Fair Payments Connector first, then Fair Events, then Fair
Audience**, all to this release, before switching. Fair Audience must be on
this release or later: it reports
`FairAudience\Services\EventsLifecycle::supports_purchase_lifecycle()`, and
the switch refuses without it (`audience_lifecycle_unavailable`). An older
Fair Audience is **not supported after the switch**: it would keep
confirming its own registrations, which Fair Events no longer follows.

**Readiness to switch.** On **Fair Events → Payment history**, the Payment
records card lists what blocks the switch
(`PaymentHistoryCutover::blockers()`): the stage 3 backfill must have
finished with a clean verification (`migration_verified()`), shadow writes
must be on, Connector readable, Fair Audience current, and no shadow or
lifecycle work queued. The switch rechecks all of it, and the verification's
global checks, under a lock; if the recheck fails, verify again first.

**Back up before switching** (`wp db export --tables=…`), and confirm it in
the dialog:

- `{prefix}fair_events_signups`, `{prefix}fair_events_tickets`,
  `{prefix}fair_events_ticket_activities`,
  `{prefix}fair_events_signup_payment_links`,
  `{prefix}fair_events_payment_shadow_work`,
  `{prefix}fair_events_payment_history_findings`,
  `{prefix}fair_events_payment_history_audit`;
- `{prefix}fair_audience_event_participants`,
  `{prefix}fair_audience_event_participant_options`,
  `{prefix}fair_audience_event_participant_transactions` (the lifecycle
  still writes them, after Fair Events);
- `{prefix}fair_payment_transactions`;
- the options `fair_events_payment_history_migration` and
  `fair_events_payment_history_cutover`.

Without the page (WP-CLI):

```bash
wp eval 'print_r( FairEvents\Services\PaymentHistoryCutover::status() );'
wp eval 'print_r( FairEvents\Services\PaymentHistoryCutover::activate( array( "backup_confirmed" => true, "user_id" => 1 ) ) );'
```

**What changes.** From the switch on, each new payment attempt is linked to
its purchases before the buyer pays (a 503 `payment_not_recorded` and no
charge when it can't be), paid notifications resolve purchases from those
links, so a late payment for an earlier attempt is honoured and a repeated
notification counts once, and Fair Audience follows what Fair Events
committed. The switch is recorded in the audit table and in the option
`fair_events_payment_history_cutover`. Statistics readers don't change
until stage 5 (#2141).

**Recovery: forward repair only.** The switch can't be undone from the page,
and a later failed verification doesn't undo it. Don't roll Fair Events or
Fair Audience back below this release afterwards: Fair Events would stop
writing links first (its gate needs this release's code), and an older Fair
Audience would confirm registrations Fair Events no longer follows. The
Payment records card lists what needs repair (`audience_lifecycle_unavailable`,
`payment_information_unavailable`, `verification_failed`) and the work
waiting to be retried every fifteen minutes. Fix the code or plugin versions,
let the queue drain, re-run the backfill for the affected range and
reconcile what's left. Restoring the backup above loses every payment
recorded since the switch; do it only if nothing was paid in between.
Deactivating a plugin isn't a rollback: the switch stays recorded.

## Upgrade notes: payment history statistics readers (#2141)

Stage 5 of the payment history migration, first of two pull requests
([PAYMENT_HISTORY_MIGRATION.md § 8.14](./PAYMENT_HISTORY_MIGRATION.md#814-stage-5-statistics-readers)).
No schema change and nothing runs on upgrade on a site with Fair Audience
records. The release adds the Events readers for Statistics, ticket counts
and capacity, and the switch that turns them on. Until an administrator
switches, Statistics read Fair Audience as before, and still need it.

**Update order: Fair Payments Connector first, then Fair Events, then Fair
Audience**, as for stage 4. Only Fair Events changes in this release.

**Sites without Fair Audience records.** A site where Fair Audience's tables
don't exist and every purchase with a payment attempt has a payment link is
switched automatically, the first time Statistics or the fifteen-minute
payment history cron sees it (reason `no_source_history`). Statistics then
work with Fair Events alone; revenue needs Fair Payments Connector.

**Readiness to switch.** On **Fair Events → Payment history**, the
Statistics card appears once payment records use Fair Events (stage 4) and
lists what blocks the switch (`PaymentHistoryReaders::blockers()`): the
stage 4 switch, a clean verification that ran **after** it
(`verification_before_cutover` otherwise: use "Verify again"), Connector
readable, no shadow or lifecycle work queued, and no event date where
Statistics still counts a signed-up Fair Audience registration without a
Fair Events purchase (`relationship_admissions`, with the dates). The switch
rechecks all of it and the verification's global checks under the stage 4
locks. No backup is needed: the switch changes no record, only which
records Statistics read.

Without the page (WP-CLI):

```bash
wp eval 'print_r( FairEvents\Services\PaymentHistoryReaders::status() );'
wp eval 'print_r( FairEvents\Services\PaymentHistoryReaders::activate( array( "user_id" => 1 ) ) );'
```

**What changes.** Ticket counts and capacity stop reading Fair Audience
registrations and participant-scope activities, and the
`fair_events_capacity_legacy_admissions` and
`fair_events_capacity_legacy_activity_selections` filters are no longer
applied. Revenue is the paid allocations of the date's purchases, with
`revenue_state` `available`, `incomplete` (paid money for the date not
fully allocated: the count and a link to Payment history) or `unavailable`
(no amount, never 0). **Occurrence totals change on purpose:** a
whole-series pass counts once, on the series master, and a generated
occurrence reports it as `series_pass_revenue` instead of adding it; a
payment shared by several dates counts each date's share. The switch is
recorded in the audit table and the option
`fair_events_payment_history_readers`.

**Verification after the switch.** Open Statistics for a few event dates
with paid sales, including one series occurrence, and compare with the
verification report on Payment history: totals match the "Events" side,
minus pass revenue on occurrences. Deactivate and reactivate Fair Audience:
the figures stay the same.

**Recovery: forward repair only.** Nothing undoes the switch: not a missing
plugin, a later failed verification or a new finding. If a date's revenue is
wrong, fix the links (re-run the backfill for the range, reconcile what's
left) rather than rolling back. Rolling Fair Events back below this release
returns Statistics to the Fair Audience ledger, which stage 4 still writes,
so older figures stay readable while you repair. Source history (ledger,
registrations, participant-scope activities) is kept; deleting it needs a
separate follow-up.

## Upgrade notes: payment history purchase readers (#2141)

Stage 5 of the payment history migration, second of two pull requests, which
completes it
([PAYMENT_HISTORY_MIGRATION.md § 8.15](./PAYMENT_HISTORY_MIGRATION.md#815-stage-5-purchase-readers-and-completion)).
No schema change and nothing runs on upgrade. Everything follows the
Statistics switch above: until it is on, every screen reads as before.

**Update order: Fair Payments Connector first, then Fair Events, then Fair
Audience.** All three change in this release. Connector adds the
`fair_payment_prepare_purchases` filter, Fair Events answers it, and Fair
Audience reads the Events readers only when its capability check
(`EventsPaymentReaders::active()`) passes, so any order works without
errors; the order above just turns everything on at once.

**What changes once the Statistics switch is on.**

- **Manage Event → Finance** keeps its payments list and adds **Purchase
  payments**: every attempt of the date's purchases, with this purchase's
  share of a shared payment and whether it counts as revenue.
- `GET fair-events/v1/get-tickets` gives each purchase a `payment_history`;
  `transaction_id` is still the latest attempt.
- **Fair Payments → Transaction** shows a **Purchases** card: which purchases
  the payment is for, on which date, and each one's share.
- **Fair Audience → participant** shows a **Purchases** card with what the
  participant bought as the purchaser and every payment of it, instead of
  the per-event Transaction column.
- A buyer returning from an earlier payment attempt sees that attempt's
  purchase.
- Payment notifications (email, Telegram) name the event, ticket type,
  activities and buyer from Fair Events' payment links, not the Fair
  Audience ledger.

**Final verification.** Follow § 8.15's checklist: both switches recorded and
no work queued on Payment history; for a few dates (a retried purchase, a
shared payment, a series pass) Statistics revenue equals the counted shares
under Purchase payments; a shared payment's Purchases card adds up to its
total; a purchaser's participant page lists the same attempts; and
deactivating and reactivating Fair Audience changes none of these.

**Recovery: forward repair only**, as for the Statistics switch. Rolling a
plugin back below this release only removes the new cards and fields; the
links and the ledger (still written since stage 4) stay intact. Source
history (ledger, registrations, participant-scope activities) is kept;
deleting it is out of scope and needs a separate follow-up issue.

## Upgrade notes: supported upgrade path after the payment history migration (#2255)

Releases after `build-2.2.0` no longer depend on the payment history
migration (#2251) and later remove it (#2252–#2254). They start only on a
site that **finished** the migration, or that was installed fresh by one of
them ([PAYMENT_HISTORY_MIGRATION.md § 8.17](./PAYMENT_HISTORY_MIGRATION.md#817-supported-upgrade-path)).
Everything below applies to every site, including client sites deployed
with `workflow_dispatch`.

**Prerequisite release: [`build-2.2.0`](https://github.com/marcin-wosinek/fair-event-plugins/releases/tag/build-2.2.0).**
It is the last release with the complete migration workflow (stages 2–5) and
the first with every step of it:

| Plugin                  | Version | Archive                             |
| ----------------------- | ------- | ----------------------------------- |
| Fair Payments Connector | 2.8.0   | `fair-payments-connector.2.8.0.zip` |
| Fair Events             | 2.2.0   | `fair-events.2.2.0.zip`             |
| Fair Audience           | 2.0.0   | `fair-audience.2.0.0.zip`           |

The archives were checked on 2026-11-11: the headers carry these versions,
Fair Events records DB `3.52.0` and ships the backfill, verification,
reconciliation, the stage 4 and stage 5 switches and the Payment history
page, and its purchase lifecycle still waits for the stage 4 switch (it
predates #2251). SHA-256 sums (`shasum -a 256`):

```text
31b22f1aca227df6a7b04c540d74aad6a9df8aed1a61532faaaf31f07d13dd16  fair-payments-connector.2.8.0.zip
a6dd5e0c9558e3617bf064554a744e2a6142c9aea6e026bd4bff5bb6121235e4  fair-events.2.2.0.zip
f4012f4fcb54fa8792e167117a04520964f195590314583d40163f2500e846d1  fair-audience.2.0.0.zip
```

**A site is ready to leave `build-2.2.0` when Payment history shows all of:**

1. A clean verification (the migration's status is _verified_).
2. Payment records switched to Fair Events (stage 4).
3. Statistics switched to Fair Events records (stage 5). A site without Fair
   Audience records gets this automatically, without the other steps.
4. No payment records waiting to move: no failed or unresolved shadow work.
   Queued work that hasn't been tried yet doesn't count.
5. No open finding, apart from the informational ones (amount differs, more
   than one paid attempt, refund records).

Versions never decide this: only these records do. The first request on a
newer Fair Events records them as the site's **completion evidence**
(`fair_events_payment_history_completion`), which later releases keep after
they remove the migration's own records. Payment history then shows
**Upgrade readiness: Safe to upgrade**.

**Procedure for an existing site.**

1. Back up the database (the tables in the stage 4 notes above, plus
   `{prefix}options`).
2. Restore it on a staging copy. On staging, update to `build-2.2.0` if the
   site runs anything older, in the order Connector → Events → Audience, and
   finish the migration there first, following the stage 3–5 notes below.
3. Run the § 8.15 final verification on staging: a paid single purchase, a
   retried purchase, a payment shared by several dates and a series pass;
   Statistics revenue against Purchase payments; a shared payment's shares
   adding up; Finance against the purchaser's participant page; and
   deactivating and reactivating Fair Audience. Update staging to the newer
   release and record the date, the versions and each check under
   **Payment history → Upgrade readiness → Staging verification**.
4. Repeat the migration on production on `build-2.2.0`, back up again, then
   update **Connector first, then Fair Events, then Fair Audience**.
5. Check that Payment history shows **Safe to upgrade**.

**Fresh installations** need none of this. A site where Fair Events was
first installed by a release after `build-2.2.0` records
`fresh_install` evidence before it creates its tables, has no migration to
run and nothing to clean up.

**Unsupported upgrades.** On an existing site without the completion
evidence, Fair Events and Fair Audience start nothing but an administrator
notice that names what is missing and links here. Neither installer runs,
so no table, option or purchase changes, and no purchase or payment is
recorded: checkout, signups and Statistics are unavailable until it is
resolved. Fair Audience also stops when Fair Events is older than this
check (update Fair Events first). The ungated experimental plugins keep
their own routes.

**Recovery from an unsupported upgrade.**

1. Reinstall the `build-2.2.0` archives over the newer plugins, in the
   order Connector → Events → Audience. Nothing needs restoring: the newer
   code wrote nothing.
2. Finish the migration on Payment history, as above.
3. No checkout can start while the site is paused, but a payment started
   before the update can still complete at the provider. Connector records
   it; Fair Events doesn't apply it to its purchase. After returning to
   `build-2.2.0`, verify the migration again and reconcile any new finding.
4. Update again.

Restore the backup only if something else went wrong. Restoring after a
supported upgrade loses every purchase made since the backup.

**Local test and development sites** installed before this release have no
evidence either, and are refused like any other existing site. Recreate
them (`npx wp-env clean all`), or, only on a throwaway site with no real
payment history, record the evidence by hand:

```bash
npx wp-env run tests-cli wp eval "add_option( 'fair_events_payment_history_completion', array( 'basis' => 'fresh_install', 'recorded_at' => gmdate( 'Y-m-d H:i:s' ), 'plugin_versions' => array() ) );"
```

**Before the cleanup releases (#2252–#2254)** the same evidence is
required; the cleanup of Fair Audience's old payment records (#2254) also
needs a clean state at that time and every staging check recorded as
passed. Payment history lists those separately as **Removing old records**;
being safe to upgrade doesn't make a site ready for it.

## Upgrade notes: payment history migration tooling removal (#2252)

Retires the one-time payment history migration
([PAYMENT_HISTORY_MIGRATION.md § 8.18](./PAYMENT_HISTORY_MIGRATION.md#818-migration-tooling-retired)).
A site that hasn't finished the migration can't run it after this release:
follow the supported upgrade path above (#2255), which refuses to start such
a site.

**Before upgrading**, check that **Fair Events → Payment history** shows
**Upgrade readiness: Safe to upgrade**. Take a database backup as usual.

**What changes.** The Payment history page keeps its menu entry and
permission but shows only the records to review and their reconciliation.
The dry run, migration, verification and switch controls are gone, and their
REST routes (`…/dry-run`, `…/backfill`, `…/backfill/resume`, `…/verify`,
`…/cutover`, `…/readers`, `…/comparisons` under
`fair-events/v1/payment-history`) return 404 `rest_no_route`. The database
upgrade to 3.54.0 only unschedules
`fair_events_payment_history_backfill_batch`; no table, column or option is
removed, and the shadow work cron stays scheduled.

**Recovery.** Rolling back restores the migration controls over the same
data: nothing this release removed held state.

## Upgrade notes: payment history shadow writes retired (#2253)

Retires the migration's shadow synchronization
([PAYMENT_HISTORY_MIGRATION.md § 8.19](./PAYMENT_HISTORY_MIGRATION.md#819-shadow-writes-retired)).
Update **Fair Events and Fair Audience together**: an older Fair Audience
doesn't report organizer changes, so participants it adds or relabels
wouldn't reach Fair Events' capacity and Statistics until it is updated.

**What changes.** The database upgrade to 3.55.0 unschedules
`fair_events_payment_history_shadow_work`; the next request schedules
`fair_events_purchase_recovery`, which retries interrupted payment,
confirmation and organizer-change work every fifteen minutes. No table,
column or option is removed: work still queued in
`{prefix}fair_events_payment_shadow_work` is finished by the new cron.

**Check after deploy.** `wp cron event list` shows
`fair_events_purchase_recovery` and no `fair_events_payment_history_shadow_work`.

**Recovery.** Rolling back reschedules the old event on the next request,
over the same queue; nothing this release removed held state.

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

`assets/` carries both the default screenshots (`screenshot-N.png`) and any
locale-suffixed sets (e.g. `screenshot-N-es.png` for Spanish, per
[TESTING.md](./TESTING.md)). The "Refresh assets" step copies everything in
`assets/` as a flat glob, so a locale set needs no workflow change — but the
default and locale sets must be re-captured together whenever the plugin UI
changes, or the listing's localized gallery drifts out of sync with the
English one.

### Optional hardening

The commit step can be gated behind a dedicated GitHub Environment (e.g. `wordpress.org`) with required reviewers. Add `environment: wordpress.org` to the `publish` job and move the two secrets onto that environment if you want a second-pair-of-eyes prompt before the live commit.
