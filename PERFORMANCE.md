# Performance

A repeatable audit of the request-time and asset cost each Fair Event plugin
adds to a public page. It exists so plugin overhead can be reasoned about
with evidence instead of guesswork, and so a later change can be compared
against a committed baseline instead of a one-off manual measurement that
would go stale immediately.

This document is informational. It does not gate CI and carries no pass/fail
thresholds — see [Interpreting the results](#interpreting-the-results) for
why.

## Environment

The audit runs against the same isolated `@wordpress/env` `tests` instance
used by `test:api:local`/`test:e2e:local` (see
[TESTING.md](./TESTING.md#isolated-wordpress-test-lifecycle)), on port
**8889** (or the tests port a worktree sets in `WP_ENV_TESTS_PORT` or
`.wp-env.override.json`, resolved like the API runner does), built from production Composer dependencies
(`composer:install:prod`). Unless `--reuse` is passed, the runner owns the
instance: it builds, starts, provisions, measures, and stops it, exactly like
the API/E2E lifecycle runner.

`.wp-env.json` mounts every distributable workspace so the audit can cover
plugins that the normal API/E2E activation set omits:

-   `fair-timetable` and `fair-calendar-button` are mounted via `mappings`
    (not the `plugins` list), so they are available to activate but are
    **not** active by default. This leaves the existing API/E2E activation
    set unchanged.
-   Every other distributable plugin is already in the `plugins` list and
    was already active by default; the runner freely reactivates whichever
    subset a scenario needs.

`fair-events-shared` is a Composer package, not a WordPress plugin (no
`fair-events-shared/fair-events-shared.php` entry file), so it is excluded
from plugin discovery.

## Measurement instrumentation

`e2e/mu-plugins/fair-performance-instrumentation.php` is a test-only mu-plugin
(same trust boundary as `fair-e2e-basic-auth.php` and `fair-e2e-support.php`:
mounted only inside the isolated wp-env `tests` instance, never shipped to
production and never mounted by the dev `docker compose` stack). It adds
three response headers, but **only** when the request carries an explicit
`X-Fair-Performance-Audit: 1` opt-in header:

| Header                             | Meaning                                             |
| ----------------------------------- | ---------------------------------------------------- |
| `X-Fair-Perf-Duration-Ms`           | Wall-clock time from mu-plugin load to response send |
| `X-Fair-Perf-Peak-Memory-Bytes`     | `memory_get_peak_usage( true )` at response send      |
| `X-Fair-Perf-Query-Count`           | `$wpdb->num_queries` at response send                 |

Backend metrics come from **5 warm samples per scenario/page** (configurable
with `--samples`), with one extra request discarded as warm-up before those
samples are taken; the runner reports the **median**, not the mean, to resist
single-request noise. Query count does not require `SAVEQUERIES` —
`$wpdb->num_queries` is always tracked.

Frontend metrics (request count and transferred JS/CSS bytes) come from a
single Playwright navigation per scenario/page, read from the Resource Timing
API (`performance.getEntriesByType('resource')`, filtered to `.js`/`.css`
URLs, summed on `transferSize` — the actual wire byte count, already
accounting for compression). Browser navigation timings (`domContentLoaded`,
`load`, etc.) are recorded for context in the raw run output but are **not**
part of the comparison table: they are too environment-sensitive (container
CPU contention, no CDN, cold caches) to treat as stable metrics.

## Fixtures

All fixtures are synthetic, created by the run and removed by it.

### Pages measured on an empty site

Two pages are created before the sweep and measured in **every** scenario,
while the site holds no events:

-   **Plain** (`fair-performance-plain`) — a single paragraph, no Fair Event
    blocks. Isolates site-wide bootstrap cost and globally (unconditionally)
    enqueued assets: a plugin that adds bytes here is loading something on
    every page load, not just where it's used.
-   **Feature** (`fair-performance-feature`) — one representative public
    block from each plugin that ships one: `fair-events/events-list`,
    `fair-audience/mailing-signup`, `fair-timetable/timetable`,
    `fair-payment/simple-payment`, `fair-form/fair-form`, and
    `fair-calendar-button/calendar-button`. `fair-finance` and `fair-platform`
    register no public blocks (admin/REST only), so they contribute no block
    markup here — their cost only shows up on the Plain page.

When a scenario's active plugin set doesn't include the plugin that owns a
given block, WordPress renders that block as empty (no registered dynamic
render callback) — this is what exposes each plugin's **conditional**
rendering and asset cost against the same fixed page content, rather than
requiring a different feature page per scenario.

### Event pages

Once every scenario has measured the two pages above, the runner seeds
events with `e2e/mu-plugins/scripts/seed-performance-fixtures.php` and
measures four more pages. The sizes are fixed (`EVENT_FIXTURES` in
`scripts/performance-runner.mjs`) so runs stay comparable over time.

-   **recurring-master** and **recurring-occurrence** — a weekly series of
    **48 occurrences**, the master included. Its ticket type is priced and
    covers several occurrences (`multiple_instances`), so the signup form
    shows the occurrence picker with all 48 dates. `recurring-master` is the
    event's own URL; `recurring-occurrence` is the same event with
    `?event_date=YYYY-MM-DD` set to occurrence 24, a generated occurrence
    that looks up its series master for pricing and configuration.
-   **event-options** — a single event with one priced ticket type and
    **16 options**, each selectable and with its own price for the active
    sale period.
-   **listings** — a page with the `fair-events/events-list`,
    `fair-events/events-calendar` and `fair-events/events-week` blocks. The
    calendar and week blocks show one date window, so the measured URL sets
    `calendar_month`, `calendar_year` and `week_view` to the first
    occurrence: both blocks contain data on every run.

Both event posts contain the event dates, event info, event prices, event
signup and get tickets blocks, in that order.

**Dates are relative to the run.** The first occurrence starts seven days
after the run, so all 48 occurrences are upcoming whenever the audit runs.
After seeding, the runner checks that the series has 48 upcoming occurrences
and that all 16 options are on offer, and fails the run otherwise. A fixture
that shrank would otherwise show up only as a cheaper page.

**Event pages are measured only in scenarios where `fair-events` is
active.** Without it the blocks render empty, which costs run time and says
nothing. Those scenarios show `n/a` in the report (see
[Reading the event pages](#reading-the-event-pages)).

### Cleanup

Every fixture post carries the `_fair_performance_fixture` post meta,
written in the same insert as the post and before any row that depends on
it. `e2e/mu-plugins/scripts/cleanup-performance-fixtures.php` deletes every
post with that meta, together with the event dates, sale periods, ticket
types, options and prices of the event posts. It works in any activation
state.

The runner calls it twice:

-   **Before creating fixtures**, to remove what an earlier run left behind
    if it was killed before its own cleanup. Leftover events would distort
    every page, the Feature page's events list first.
-   **After measuring**, before it restores the plugin activation state. This
    also runs after a failed seed, a failed measurement, and
    `SIGINT`/`SIGTERM`.

If removing the fixtures, restoring the plugins or stopping the environment
fails, the runner says which step failed and exits non-zero. An earlier
failure keeps its own exit code.

## Activation matrix

Built from each plugin's own header (`Plugin Name`, `Requires Plugins`) via
`loadPluginCatalog()`/`buildComparisonMatrix()` in
`scripts/performance-runner.mjs` — not hand-maintained here, so it always
matches the current workspace list:

1. `wordpress-only` — baseline, no Fair Event plugin active.
2. Each **standalone** plugin (no `Requires Plugins` header) alone.
3. Each **dependency-bound** plugin (`fair-events-experimental`,
   `fair-audience-experimental`) together with its required base plugin.
4. `production-stack` — every non-`-experimental` plugin together.
5. `production-stack+experimental` — the production stack plus every
   `-experimental` plugin.

For the Plain and Feature pages, every comparison reports the delta from the
`wordpress-only` baseline for median duration, query count, peak memory,
request count, and transferred JS/CSS bytes.

### Reading the event pages

The event pages have no `wordpress-only` measurement, so there is nothing to
subtract. Their tables show absolute numbers and `—` in every delta column.
Compare an event page with the same page in another scenario or in an
earlier run.

A scenario that does not measure the event pages gets a row of `n/a`, and
the reason is printed under the table. In the JSON report those rows are not
in `results`; they are listed in a separate `skipped` array, each with
`scenario`, `page`, `status: "n/a"` and `reason`. `results` holds only
measured pages.

## Running it

```bash
npm run performance                        # owns the environment end-to-end
npm run performance -- --reuse              # against an already-started instance
npm run performance -- --samples=10         # more warm samples per scenario/page
npm run performance -- --scenario=fair-events  # focus one scenario
npm run performance -- --out=report.md      # also write the markdown report to a file
```

`--reuse` behaves like `test:api:local -- --reuse`: it skips build, Composer
install, and start/stop, and expects
`npm run test:wp-env:start` to have already been run.

The runner always removes its fixtures (see [Cleanup](#cleanup)) and then
restores whichever plugins were active before it ran — including after a
thrown error or `SIGINT`/`SIGTERM` — so a failed or interrupted run never
leaves the instance with extra data or in a different activation state than
it found it in.

`--scenario` focuses both phases. With a scenario that doesn't include
`fair-events`, no events are seeded and the event pages are reported as
`n/a`.

### Running it on consistent hardware

A local run's absolute numbers depend on whatever else is running on your
machine at the time — not just background load, but longer-lived state like
thermal throttling on a laptop. **`.github/workflows/performance.yml`** runs
the identical `npm run performance` command on GitHub's hosted runners
instead, which have a fixed, uniform spec. It is `workflow_dispatch`-only —
never on push or pull request — consistent with keeping this benchmark
manually invoked with no CI gate. Trigger it from the Actions tab or:

```bash
gh workflow run performance.yml -f samples=5
gh workflow run performance.yml -f samples=10 -f scenario=fair-events
```

The report is posted to the run's job summary and uploaded as a
`performance-report` artifact (30-day retention). Hosted runners aren't
perfectly noise-free either (shared virtualization), but the variance is far
smaller than laptop-to-laptop or day-to-day laptop load — good enough to
compare two runs of this workflow against each other, which a personal
machine's numbers are not.

### History

Every workflow run also publishes its `--json-out` report to the long-lived
`performance-history` branch, using the generic branch-storage helpers in
`scripts/pr-assets.mjs` (the Contents API via the already-authenticated `gh`
CLI, no new secret needed). Responsive-UI screenshots no longer use a branch —
they are GitHub attachments on the PR (see [COMMIT_GUIDE.md](./COMMIT_GUIDE.md)).
Each run writes two files, never a local checkout:

-   `<date>-<run-id>.json` — one immutable entry per run, keyed by the
    GitHub Actions run id, so it never collides or gets overwritten.
-   `latest.json` — always replaced, a stable link to the newest report:
    `https://raw.githubusercontent.com/<owner>/<repo>/performance-history/latest.json`.

This gives a growing, versioned record instead of results disappearing when
the 30-day workflow artifact expires. It's just an accumulating list of
snapshots, though — nothing here charts or diffs runs automatically yet; a
future script could read `performance-history`'s file list and build a trend
view. The JSON contains only plugin slugs, scenario names, and numeric
performance figures, so publishing it to this public repo carries the same
"synthetic data only" posture documented for screenshots — there's nothing
further to redact.

## Interpreting the results

-   **Server-side deltas (duration, queries, memory) are the most reliable
    signal.** They come from the actual PHP request lifecycle, not the
    browser.
-   **Frontend request/byte counts** are reliable for "how many files, how
    many bytes" but the container has no CDN, no HTTP/2 multiplexing tuning,
    and no production caching — don't read absolute millisecond timings from
    the frontend measurement as representative of a real host.
-   **No Lighthouse score or Core Web Vitals** are captured or used as
    acceptance criteria: those are dominated by the local container, browser,
    theme, and host, not by plugin code.
-   **No CI gate, no hard budget.** A single local run is a snapshot, not a
    trend; container timing varies run to run. This becomes meaningful once
    repeat runs establish a stable range — that's a follow-up, not part of
    this baseline.
-   A material, unconditional cost on the **Plain** page (present with no
    matching block on the page) is the strongest evidence of a global
    bootstrap or asset-enqueuing cost worth investigating; the **Feature**
    page cost should track roughly with active/present blocks and is
    evidence of conditional rendering cost only.

-   On the **event pages**, read the query count against the fixture size.
    A count that moves with the 48 occurrences or the 16 options points at
    per-item work; a count close to the other event pages points at fixed
    cost.

This ticket is measurement and evidence only. Where a comparison surfaces a
material bottleneck, the "Findings" section below names it, attributes it to
bootstrap/query/memory/asset cost, and links a follow-up issue — it does not
change any plugin code to fix it.

## Baseline results

Captured by the hosted workflow with 5 samples
([run 37893895054](https://github.com/marcin-wosinek/fair-event-plugins/actions/runs/37893895054):
a clean, owned isolated instance, PHP 8.3, production Composer
dependencies), at revision `235e93ea`. Generated by `npm run performance`;
do not hand-edit the tables below — re-run the command and paste its output
instead.

This is the last full sweep. The event pages were re-measured for the
`fair-events` and `production-stack` scenarios on 2026-10-20; see
[Event Signup re-measurement](#event-signup-re-measurement-2026-10-20).

# Performance audit results

Generated: 2026-10-09T06:37:17.934Z

## plain page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | 41.5 | — | 21 | — | 8.00 | — | 3 | — | 22.1 | — |
| fair-payments-connector | 41.4 | -0.2 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-events | 44.8 | +3.3 ms | 26 | +5 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-platform | 40.4 | -1.1 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience | 41.8 | +0.2 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-timetable | 40.2 | -1.3 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-finance | 39.3 | -2.2 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-payments-connector-experimental | 39.8 | -1.7 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-form | 43.1 | +1.6 ms | 23 | +2 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-calendar-button | 40.8 | -0.7 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-events-experimental+deps | 45.6 | +4.1 ms | 28 | +7 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience-experimental+deps | 41.8 | +0.3 ms | 23 | +2 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| production-stack | 51.1 | +9.5 ms | 32 | +11 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| production-stack+experimental | 52.5 | +10.9 ms | 35 | +14 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |

## feature page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | 40.9 | — | 21 | — | 8.00 | — | 3 | — | 22.1 | — |
| fair-payments-connector | 43.1 | +2.2 ms | 23 | +2 | 8.00 | 0.0 KB | 9 | +6 | 38.4 | +16.3 KB |
| fair-events | 58.9 | +18.0 ms | 27 | +6 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-platform | 41.9 | +1.0 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience | 42.5 | +1.6 ms | 23 | +2 | 8.00 | 0.0 KB | 9 | +6 | 38.1 | +16.0 KB |
| fair-timetable | 40.9 | +0.0 ms | 22 | +1 | 8.00 | 0.0 KB | 6 | +3 | 27.2 | +5.1 KB |
| fair-finance | 40.1 | -0.8 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-payments-connector-experimental | 39.9 | -1.0 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-form | 44.9 | +4.0 ms | 23 | +2 | 8.00 | 0.0 KB | 12 | +9 | 83.7 | +61.6 KB |
| fair-calendar-button | 40.9 | 0.0 ms | 21 | 0 | 8.00 | 0.0 KB | 6 | +3 | 54.6 | +32.6 KB |
| fair-events-experimental+deps | 58.9 | +18.0 ms | 29 | +8 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience-experimental+deps | 42.5 | +1.6 ms | 24 | +3 | 8.00 | 0.0 KB | 9 | +6 | 38.1 | +16.0 KB |
| production-stack | 69.0 | +28.1 ms | 35 | +14 | 10.00 | +2048.0 KB | 16 | +13 | 116.1 | +94.0 KB |
| production-stack+experimental | 68.9 | +28.0 ms | 38 | +17 | 10.00 | +2048.0 KB | 16 | +13 | 116.1 | +94.0 KB |

## recurring-master page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events | 103.7 | — | 101 | — | 8.00 | — | 36 | — | 519.8 | — |
| fair-platform | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-audience | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-timetable | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-finance | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector-experimental | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-form | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-calendar-button | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events-experimental+deps | 103.3 | — | 103 | — | 8.00 | — | 36 | — | 519.8 | — |
| fair-audience-experimental+deps | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| production-stack | 110.9 | — | 107 | — | 10.00 | — | 36 | — | 519.8 | — |
| production-stack+experimental | 106.4 | — | 110 | — | 10.00 | — | 36 | — | 519.8 | — |

n/a: not measured where fair-events is inactive — the page's blocks would render empty.

## recurring-occurrence page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events | 98.0 | — | 94 | — | 8.00 | — | 36 | — | 519.8 | — |
| fair-platform | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-audience | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-timetable | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-finance | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector-experimental | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-form | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-calendar-button | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events-experimental+deps | 99.2 | — | 96 | — | 8.00 | — | 36 | — | 519.8 | — |
| fair-audience-experimental+deps | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| production-stack | 102.7 | — | 100 | — | 10.00 | — | 36 | — | 519.8 | — |
| production-stack+experimental | 106.5 | — | 103 | — | 10.00 | — | 36 | — | 519.8 | — |

n/a: not measured where fair-events is inactive — the page's blocks would render empty.

## event-options page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events | 66.7 | — | 82 | — | 8.00 | — | 36 | — | 519.8 | — |
| fair-platform | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-audience | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-timetable | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-finance | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector-experimental | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-form | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-calendar-button | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events-experimental+deps | 69.4 | — | 84 | — | 8.00 | — | 36 | — | 519.8 | — |
| fair-audience-experimental+deps | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| production-stack | 73.3 | — | 88 | — | 10.00 | — | 36 | — | 519.8 | — |
| production-stack+experimental | 75.3 | — | 91 | — | 10.00 | — | 36 | — | 519.8 | — |

n/a: not measured where fair-events is inactive — the page's blocks would render empty.

## listings page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events | 73.9 | — | 60 | — | 8.00 | — | 6 | — | 27.1 | — |
| fair-platform | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-audience | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-timetable | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-finance | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-payments-connector-experimental | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-form | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-calendar-button | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| fair-events-experimental+deps | 77.7 | — | 62 | — | 8.00 | — | 6 | — | 27.1 | — |
| fair-audience-experimental+deps | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |
| production-stack | 82.4 | — | 66 | — | 10.00 | — | 6 | — | 27.1 | — |
| production-stack+experimental | 84.1 | — | 69 | — | 10.00 | — | 6 | — | 27.1 | — |

n/a: not measured where fair-events is inactive — the page's blocks would render empty.

## Event Signup re-measurement (2026-10-20)

Two focused hosted runs, one per scenario, measured the event pages after
the Event Signup public script stopped importing editor components
(c8634555, [#1768](https://github.com/marcin-wosinek/fair-event-plugins/issues/1768)):

-   **Revision:** `271b6125` on `main`.
-   **Runs:** [39384880513](https://github.com/marcin-wosinek/fair-event-plugins/actions/runs/39384880513)
    (`--scenario=fair-events`) and
    [39384883723](https://github.com/marcin-wosinek/fair-event-plugins/actions/runs/39384883723)
    (`--scenario=production-stack`), both with 5 samples. JSON reports are
    on the `performance-history` branch as `2026-10-20-<run id>.json`.
-   **Conditions:** the same as the baseline above. Hosted `ubuntu-latest`
    runner, a clean owned isolated instance, PHP 8.3, production Composer
    dependencies, unchanged fixtures (48 occurrences, 16 options) and
    unchanged page markup, which still contains both the Event Signup and
    the legacy Get Tickets block. Only the revision differs.
-   **Local check:** a local `--reuse` run at the same revision, against a
    freshly reset tests database, measured the same requests and transfer
    (15 requests, 123.6 KB) on all six rows.

The tables below are the event-page sections of both reports, generated by
`npm run performance` and merged by scenario:

### recurring-master page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fair-events | 99.2 | — | 209 | — | 8.00 | — | 15 | — | 123.6 | — |
| production-stack | 103.7 | — | 215 | — | 10.00 | — | 15 | — | 123.6 | — |

### recurring-occurrence page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fair-events | 94.1 | — | 204 | — | 8.00 | — | 15 | — | 123.6 | — |
| production-stack | 105.4 | — | 210 | — | 10.00 | — | 15 | — | 123.6 | — |

### event-options page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fair-events | 60.6 | — | 90 | — | 8.00 | — | 15 | — | 123.6 | — |
| production-stack | 53.3 | — | 96 | — | 10.00 | — | 15 | — | 123.6 | — |

### Frontend before and after

Baseline: run 37893895054 at `235e93ea`. After: the runs above.

| Scenario | Page | Requests before → after | Δ Requests | Transfer before → after (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- |
| fair-events | recurring-master | 36 → 15 | −21 (−58%) | 519.8 → 123.6 | −396.2 (−76%) |
| fair-events | recurring-occurrence | 36 → 15 | −21 (−58%) | 519.8 → 123.6 | −396.2 (−76%) |
| fair-events | event-options | 36 → 15 | −21 (−58%) | 519.8 → 123.6 | −396.2 (−76%) |
| production-stack | recurring-master | 36 → 15 | −21 (−58%) | 519.8 → 123.6 | −396.2 (−76%) |
| production-stack | recurring-occurrence | 36 → 15 | −21 (−58%) | 519.8 → 123.6 | −396.2 (−76%) |
| production-stack | event-options | 36 → 15 | −21 (−58%) | 519.8 → 123.6 | −396.2 (−76%) |

Each event page now costs 12 requests and 101.5 KB more than the plain page
(3 requests, 22.1 KB). The companion plugins in `production-stack` add no
request on these pages.

### Public dependencies

The built `fair-events/build/blocks/event-signup/frontend.asset.php` lists
`wp-api-fetch`, `wp-date` and `wp-i18n`. Across all six rows, the asset URLs
recorded in the JSON reports contain no React and no block-editor component
library. These 21 scripts loaded in the baseline and are gone: `react`,
`react-jsx-runtime`, `react-dom`, `dom-ready`, `a11y`, `dom`, `escape-html`,
`element`, `is-shallow-equal`, `keycodes`, `priority-queue`, `undo-manager`,
`compose`, `html-entities`, `primitives`, `redux-routine`, `data`,
`rich-text`, `theme`, `warning` and `components`.

The remaining requests are WordPress's own `hooks`, `i18n`,
`private-apis`, `url`, `api-fetch`, `deprecated`, `date` and `moment`
(dependencies of the three packages above), the Event Signup script, the
calendar button's script and stylesheet, and the theme's navigation,
interactivity and emoji assets.

### Functional checks

Run sequentially on the local isolated instance at `271b6125`:

-   49 of 49 tests passed in the root `e2e/user-flows/` signup specs.
    These cover purchase and payment hand-off, occurrence selection,
    returning participants, participant tokens, group discounts, nested and
    conditional questions, activities and options.
-   19 of 20 tests passed in the fair-events `event-signup-*` specs and
    `duration-options-translations.spec.js`. The failure is the known stale
    assertion in `event-signup-mailing-consent.spec.js`: the public signups
    succeed, then the spec looks for an email column that the admin List
    tab does not show. It fails the same way before this change.
-   `fair-events/e2e/event-signup-translations.spec.js` passed in both the
    language-pack and the bundled delivery mode, and in English. It checks
    that the Spanish messages of the Event Signup script reach an anonymous
    visitor on the event page.

## Series coverage re-measurement (2026-10-28)

Local runs before and after series coverage started reading its dates
together ([#1996](https://github.com/marcin-wosinek/fair-event-plugins/issues/1996)).
`SeriesCoverage` now reads the picker dates and the whole-series dates with
one `EventDates::get_by_ids()` query, and takes their remaining places from
those rows through `TicketCapacity::remaining_for_event_dates()`, instead of
one `EventDates::get_by_id()` per occurrence. A date with a limit still has
its admissions counted fresh on every request, as before.

-   **Revisions:** before is `f4d13535` on `main`; after is the #1996 change
    applied to `f4d13535`.
-   **Environment:** the local isolated `tests` instance (`--reuse`),
    WordPress 7.1.3, PHP 8.3.35, MariaDB 12.3.3, Twenty Twenty-Five, no
    persistent object cache. Absolute numbers from this laptop are not
    comparable with the hosted runs above; the two columns below are
    comparable with each other.
-   **Runs:** `npm run performance -- --reuse --scenario=fair-events`, 5
    samples, unchanged fixtures (48 occurrences, both signup forms on the
    page, no capacity limit).

| Page | Queries before → after | Δ Queries |
| --- | --- | --- |
| plain | 32 → 32 | 0 |
| feature | 41 → 41 | 0 |
| recurring-master | 210 → 116 | −94 |
| recurring-occurrence | 205 → 111 | −94 |
| event-options | 90 → 90 | 0 |
| listings | 53 → 53 | 0 |

Durations moved in both directions by up to 42 ms between the two local
runs on pages the change does not touch (the plain page took 68.7 ms
before and 106.0 ms after), so they are not reported.

### Query trace by size, form count and capacity

`series-coverage-query-trace.php` (in `e2e/mu-plugins/scripts/`) renders an
event post's blocks as an anonymous visitor, then runs the viewer-context
refresh, and counts three groups of queries: all of them, single event
date reads by ID (`date reads`), and ticket-unit and unbackfilled-signup
counts (`admission counts`). `GetTicketsSeriesCoverage.api.spec.js` runs it
for weekly series of 3 and 48 dates, with one form (Event Signup) and two
(Event Signup and Get Tickets), on the series page and on its middle
occurrence, with no limit and with 5 places per date. The table shows the
series page with fair-audience inactive; the occurrence page's render costs
one or two queries more in every row, the same before and after.

| Places | Dates | Forms | Render: total / date reads / admission counts | Refresh: total / date reads / admission counts |
| --- | --- | --- | --- | --- |
| no limit | 3 | 1 | 22 / 5 / 0 → 20 / 2 / 0 | 18 / 4 / 0 → 16 / 1 / 0 |
| no limit | 3 | 2 | 38 / 9 / 0 → 34 / 3 / 0 | 18 / 4 / 0 → 16 / 1 / 0 |
| no limit | 48 | 1 | 67 / 50 / 0 → 20 / 2 / 0 | 63 / 49 / 0 → 16 / 1 / 0 |
| no limit | 48 | 2 | 128 / 99 / 0 → 34 / 3 / 0 | 63 / 49 / 0 → 16 / 1 / 0 |
| 5 | 3 | 1 | 34 / 5 / 6 → 32 / 2 / 6 | 30 / 4 / 6 → 28 / 1 / 6 |
| 5 | 3 | 2 | 62 / 9 / 12 → 58 / 3 / 12 | 30 / 4 / 6 → 28 / 1 / 6 |
| 5 | 48 | 1 | 259 / 50 / 96 → 212 / 2 / 96 | 255 / 49 / 96 → 208 / 1 / 96 |
| 5 | 48 | 2 | 512 / 99 / 192 → 418 / 3 / 192 | 255 / 49 / 96 → 208 / 1 / 96 |

-   **Removed:** one date read per occurrence per form. Without a limit, a
    form's queries no longer depend on the number of dates.
-   **Remaining:** with a limit, each date still costs 4 queries per form
    (2 admission counts, plus the date row and series IDs that
    `count_event_date()` reads), so 48 limited dates still add about 190
    queries per form. With fair-audience active, its
    `fair_events_capacity_legacy_admissions` filter adds one more count per
    date (144 admission counts for 48 dates instead of 96). Batching the
    admission counts was outside #1996.

## Events list scaling

`npm run performance -- --events-list-scaling` measures how the
`fair-events/events-list` block grows with the number of events
([#1669](https://github.com/marcin-wosinek/fair-event-plugins/issues/1669)).
It replaces the activation matrix with its own sweep and shares the rest of
the runner: the owned or `--reuse`d environment, the warm-up and medians of
`--samples`, the fixture cleanup, and the restored activation state.

### What it measures

Only `fair-events` is active, and nothing reaches an external source.
`e2e/mu-plugins/scripts/seed-events-list-fixtures.php` seeds one sweep at
one size, and the runner removes it before the next. There are two sweeps,
each at an empty size and three non-empty ones:

-   **events** — 0, 10, 50 and 200 distinct published events, each with
    one upcoming date. Event N starts N days after the first, which starts
    seven days after the run. Each event has an excerpt, a meta value, and
    one of three synthetic categories (on the post and on its date) and
    venues.
-   **recurring** — one published event whose weekly series has 0, 10, 50
    or 100 occurrences, master included. A series holds at most 100
    (`RecurrenceService::MAX_OCCURRENCES`), so `--sizes` above 100 are
    capped for this sweep. The Upcoming view groups the series into one
    entry, so this sweep separates stored occurrences from rendered
    entries.

At each size the runner measures four pages, all with default block
settings (Upcoming, no category or event source filter):

| Page | Layout | Renders |
| --- | --- | --- |
| `control` | a paragraph, no Fair Event blocks | nothing |
| `bundled-query-loop` | the bundled `fair-events/event-list` Query Loop pattern | at most 10 posts (its `perPage`) |
| `scaled-query-loop` | a synced copy of that pattern with `perPage` set to the size | every event |
| `per-event` | a synced per-event pattern (title link, `{{date_range}}`, `{{location}}`, `{{description}}`) | every eligible occurrence |

Limits belong to Query Loop patterns, not to the block, so the scaled
pattern is benchmark-only and no production setting was added. The bundled
pattern at a growing size tells stored events apart from rendered ones.

### Checks and instrumentation

The seed reports stored events, series and upcoming feed occurrences, and
the runner fails the run unless they match the size. It also fails if the
site holds **any other upcoming occurrence**: leftovers of E2E runs add to
every list. Run it on a freshly reset tests database
(`npx wp-env reset tests`, then
`npx wp-env run tests-cli wp rewrite structure '/%postname%/' --hard` before
a `--reuse` run).

Every measured response is checked too. The runner counts the rendered
entries (`li.wp-block-post` and `.event-list-item`) in the HTML and the
lists the instrumentation saw, and fails on an error page or on any other
count than expected. A fixture that rendered less would only read as a
cheaper list.

`fair-performance-instrumentation.php` adds these headers to opted-in
requests:

| Header | Meaning |
| --- | --- |
| `X-Fair-Perf-List-Count` | Events lists rendered (outermost only) |
| `X-Fair-Perf-List-Query-Count` | Queries made inside their render, nested blocks included |
| `X-Fair-Perf-List-Duration-Ms` | Wall-clock time inside their render |
| `X-Fair-Perf-Environment` | WordPress, PHP and database versions, theme, active plugins, persistent object cache and OPcache state |

Page queries minus list queries is the fixed page/bootstrap cost, and
the `control` page measures that cost on its own. For attribution, each
list page gets one more request with `X-Fair-Performance-Profile: 1`. That
request turns on `SAVEQUERIES` and appends the list's queries, with their
callers, to the page as an HTML comment. The runner groups them by the last
two caller frames and the query shape (literals as `?`). It then reports the
groups whose count changes across the non-empty sizes. Recording slows
every query, so those requests are never timed.

**Cache conditions.** There is no persistent object cache, so every request
starts with an empty object cache. Data cached during a request lives only
for that request. OPcache is on, and the discarded warm-up request leaves
PHP's opcode cache and the database buffers warm for the measured requests.

```bash
npm run performance -- --events-list-scaling                # owns the environment
npm run performance -- --reuse --events-list-scaling         # against a reset, running instance
npm run performance -- --reuse --events-list-scaling --sizes=0,20,100
```

### Results (2026-10-21)

Measured locally against this worktree's wp-env `tests` instance, at
`78422b86` before and with the batching below after. Each run used a freshly
reset database, the default sizes, and 5 samples after a discarded warm-up.
The environment was WordPress 7.1.3, PHP 8.3.35, MariaDB 12.3.3 and
Twenty Twenty-Five, with only `fair-events/fair-events.php` active, no
persistent object cache and OPcache on. These are local numbers: query
counts are exact, but durations vary between runs (the `control` page took
43–77 ms within one run).

**Before**, the profile of `scaled-query-loop` in the events sweep showed two
queries per rendered post. No other list page and no recurring size had a
growing query group.

| Caller | Query | 0 | 10 | 50 | 200 |
| --- | --- | --- | --- | --- | --- |
| `FairEvents\Helpers\EventsListSeries::upcoming_date_text_for_post → FairEvents\Helpers\EventsListSeries::get_next_row_for_post` | `SELECT ed.id FROM `wp_fair_event_dates` ed WHERE ed.status = ? AND ( CONCAT( ed.start_dat…` | 0 | 10 | 50 | 200 |
| `FairEvents\Helpers\EventsListSeries::get_next_row_for_post → FairEvents\Models\EventDates::get_by_id` | `SELECT * FROM `wp_fair_event_dates` WHERE id = ? LIMIT ?` | 0 | 10 | 50 | 200 |

Both come from `EventsListSeries::upcoming_date_text_for_post()`, which the
`fair-events/event-dates` block inside a Query Loop layout calls for each
post. It looks up the post's next upcoming row, then loads it. The bundled
pattern pays the same 20 queries for its 10 posts.

**Change.** While a Query Loop layout renders, a `the_posts` filter hands the
posts its query returned to `EventsListSeries::preload_next_rows()`. That
call loads every post's next row with two queries in all: the row IDs, then
`EventDates::get_by_ids()`. The lookup selects the same rows in the same
order as before, so the output is unchanged.

Before → after for the events sweep, from the two JSON reports (list
duration is a median of local runs, so read it as a trend):

| Size | Page | Rendered | Page queries | List queries | List duration (ms) |
| --- | --- | --- | --- | --- | --- |
| 10 | bundled-query-loop | 10 | 57 → 39 | 26 → 8 | 21.4 → 14.3 |
| 10 | scaled-query-loop | 10 | 58 → 40 | 27 → 9 | 12.4 → 7.1 |
| 10 | per-event | 10 | 40 → 40 | 9 → 9 | 5.6 → 6.1 |
| 50 | bundled-query-loop | 10 | 57 → 39 | 26 → 8 | 22.0 → 16.2 |
| 50 | scaled-query-loop | 50 | 138 → 40 | 107 → 9 | 42.0 → 20.0 |
| 50 | per-event | 50 | 40 → 40 | 9 → 9 | 20.6 → 21.6 |
| 200 | bundled-query-loop | 10 | 57 → 39 | 26 → 8 | 26.1 → 22.8 |
| 200 | scaled-query-loop | 200 | 438 → 40 | 407 → 9 | 129.9 → 80.4 |
| 200 | per-event | 200 | 40 → 40 | 9 → 9 | 75.6 → 80.5 |

The full report of the run after the change, generated by
`npm run performance -- --reuse --events-list-scaling`:

#### events sweep: distinct events, one date each

| Size | Page | Stored events | Series | Upcoming occurrences | Rendered | Queries | List queries | Duration (ms) | List duration (ms) | Peak memory (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | control | 0 | 0 | 0 | 0 | 31 | 0 | 60.2 | 0.0 | 8.00 |
| 0 | bundled-query-loop | 0 | 0 | 0 | 0 | 32 | 1 | 95.3 | 12.2 | 8.00 |
| 0 | scaled-query-loop | 0 | 0 | 0 | 0 | 33 | 2 | 50.6 | 1.3 | 8.00 |
| 0 | per-event | 0 | 0 | 0 | 0 | 33 | 2 | 43.3 | 0.6 | 8.00 |
| 10 | control | 10 | 0 | 10 | 0 | 31 | 0 | 42.6 | 0.0 | 8.00 |
| 10 | bundled-query-loop | 10 | 0 | 10 | 10 | 39 | 8 | 59.0 | 14.3 | 8.00 |
| 10 | scaled-query-loop | 10 | 0 | 10 | 10 | 40 | 9 | 60.0 | 7.1 | 8.00 |
| 10 | per-event | 10 | 0 | 10 | 10 | 40 | 9 | 58.0 | 6.1 | 8.00 |
| 50 | control | 50 | 0 | 50 | 0 | 31 | 0 | 68.5 | 0.0 | 8.00 |
| 50 | bundled-query-loop | 50 | 0 | 50 | 10 | 39 | 8 | 66.0 | 16.2 | 8.00 |
| 50 | scaled-query-loop | 50 | 0 | 50 | 50 | 40 | 9 | 74.9 | 20.0 | 8.00 |
| 50 | per-event | 50 | 0 | 50 | 50 | 40 | 9 | 73.2 | 21.6 | 8.00 |
| 200 | control | 200 | 0 | 200 | 0 | 31 | 0 | 76.3 | 0.0 | 8.00 |
| 200 | bundled-query-loop | 200 | 0 | 200 | 10 | 39 | 8 | 76.9 | 22.8 | 10.00 |
| 200 | scaled-query-loop | 200 | 0 | 200 | 200 | 40 | 9 | 168.0 | 80.4 | 10.00 |
| 200 | per-event | 200 | 0 | 200 | 200 | 40 | 9 | 134.4 | 80.5 | 10.00 |

#### recurring sweep: one weekly series

| Size | Page | Stored events | Series | Upcoming occurrences | Rendered | Queries | List queries | Duration (ms) | List duration (ms) | Peak memory (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | control | 0 | 0 | 0 | 0 | 31 | 0 | 57.5 | 0.0 | 8.00 |
| 0 | bundled-query-loop | 0 | 0 | 0 | 0 | 32 | 1 | 56.1 | 9.6 | 8.00 |
| 0 | scaled-query-loop | 0 | 0 | 0 | 0 | 33 | 2 | 72.0 | 1.3 | 8.00 |
| 0 | per-event | 0 | 0 | 0 | 0 | 33 | 2 | 52.8 | 0.9 | 8.00 |
| 10 | control | 1 | 1 | 10 | 0 | 31 | 0 | 50.1 | 0.0 | 8.00 |
| 10 | bundled-query-loop | 1 | 1 | 10 | 1 | 40 | 9 | 58.0 | 11.9 | 8.00 |
| 10 | scaled-query-loop | 1 | 1 | 10 | 1 | 41 | 10 | 75.6 | 4.3 | 8.00 |
| 10 | per-event | 1 | 1 | 10 | 1 | 42 | 11 | 52.0 | 3.2 | 8.00 |
| 50 | control | 1 | 1 | 50 | 0 | 31 | 0 | 76.8 | 0.0 | 8.00 |
| 50 | bundled-query-loop | 1 | 1 | 50 | 1 | 40 | 9 | 101.5 | 16.4 | 8.00 |
| 50 | scaled-query-loop | 1 | 1 | 50 | 1 | 41 | 10 | 54.8 | 3.7 | 8.00 |
| 50 | per-event | 1 | 1 | 50 | 1 | 42 | 11 | 51.0 | 5.2 | 8.00 |
| 100 | control | 1 | 1 | 100 | 0 | 31 | 0 | 72.3 | 0.0 | 8.00 |
| 100 | bundled-query-loop | 1 | 1 | 100 | 1 | 40 | 9 | 66.8 | 14.0 | 8.00 |
| 100 | scaled-query-loop | 1 | 1 | 100 | 1 | 41 | 10 | 54.8 | 4.7 | 8.00 |
| 100 | per-event | 1 | 1 | 100 | 1 | 42 | 11 | 86.2 | 6.8 | 8.00 |

No query group grows on any list page after the change.

### What this shows, and what it does not

-   **Established and fixed:** two queries per rendered post in Query Loop
    layouts. These were the only queries that grew with the event count.
-   **Established, no repeated lookups:** the per-event layout makes 9 list
    queries at every size up to 200 occurrences.
    `EventFeedProvider::load_related()` already loads posts, meta, terms,
    categories and venues for the whole range. One recurring series with up
    to 100 occurrences costs the same queries at every size in all layouts.
-   **Remaining growth is rendering time, not queries.** With every event
    rendered, the list takes about 80 ms at 200 entries in both layouts,
    against 6–7 ms at 10. That time goes into rendering the blocks of each
    entry. It was not profiled further.
-   **Stored events behind a fixed limit.** The bundled pattern renders 10
    posts at every size. Its query count stays flat. Its list duration (14 →
    23 ms) and peak memory (8 → 10 MB) grow slightly from 10 to 200 stored
    events. By reading the code, this is likely the block's own
    `WP_Query` with `posts_per_page => -1`, which only checks that any event
    matches. It still loads every matching post. This was measured but not
    attributed by profiling and not changed.
-   **Not tested:** more than 200 events or 100 occurrences per series;
    several series in one list (`EventsListSeries::load_series()` makes one
    query per distinct series shown, which this sweep never grows); category
    and event-source filters; the Past, Ongoing and All views; a persistent
    object cache; and the hosted runner.

## Findings

Ranked by measured impact; each was verified past the aggregate table before
being written up here (see the linked issue for the verification detail).

1. **Fixed: the Event Signup form added about 33 requests and 500 KB of
   frontend JS/CSS to every event page — frontend asset cost.** In the
   baseline, all three event pages loaded 36 requests / 520 KB with only
   `fair-events` active, against 3 requests / 22 KB on the plain page. The
   public script of the form depended on the block-editor component
   library, which brought React and its dependency chain onto the public
   page. Since c8634555 the event pages load 15 requests / 124 KB in both
   `fair-events` and `production-stack`, without React or the component
   library
   ([re-measurement](#event-signup-re-measurement-2026-10-20),
   [#1827](https://github.com/marcin-wosinek/fair-event-plugins/issues/1827)).
   The mailing signup, Fair Form and payment blocks had the same problem
   ([#1668](https://github.com/marcin-wosinek/fair-event-plugins/issues/1668),
   fixed) and now add 6–9 requests each on the feature page.

2. **Fixed: each signup form on a series page read every occurrence once —
   query-count cost.** The same commit added series coverage to the signup
   form. Between the baseline and the re-measurement, the series master went
   from 101 to 209 queries and the mid-series occurrence from 94 to 204
   (`fair-events`), while the single-date options event moved only from 82
   to 90. A WP-CLI query trace of the master page attributed 48 queries in
   each of the two signup forms (Event Signup and Get Tickets) to
   `TicketCapacity::remaining_for_event_date()` loading
   `EventDates::get_by_id()` once per occurrence, called from
   `SeriesCoverage::describe()`. Coverage now reads its dates with one query,
   and the master and occurrence pages each take 94 queries fewer in a
   local comparison. Dates with a capacity limit still count their
   admissions once per date
   ([re-measurement](#series-coverage-re-measurement-2026-10-28),
   [#1996](https://github.com/marcin-wosinek/fair-event-plugins/issues/1996)).

3. **The events calendar and week blocks query per displayed occurrence —
   query-count cost.** The `listings` page costs 60 queries with
   `fair-events` alone, against 27 for the events list on an empty site
   (feature page). Probe pages with one block each, measured before and
   after seeding the fixtures, attribute the growth: the calendar added 20
   queries for the 4 fixture occurrences in its month, the week view 11 for
   the 2 in its week, the events list 1. That is about 5 queries per
   displayed occurrence in both blocks. The same probe on a test site with
   252 occurrences in the displayed month measured about 890 queries for the
   calendar block alone.
   Follow-up: [#1828](https://github.com/marcin-wosinek/fair-event-plugins/issues/1828).

4. **In the baseline, an event page cost 80–100 queries, mostly
   independent of fixture size — fixed rendering cost.** With `fair-events` alone the plain page
   takes 26 queries, the options event 82, the mid-series occurrence 94 and
   the series master 101. The 48 occurrences account for at most 19 queries
   (master against the single-date options event), well under one per
   occurrence, so neither the occurrence picker nor the options list has an
   N+1 shape at these sizes. The remaining ~55 queries are the fixed cost of
   five event blocks, two of which are signup forms (Event Signup and the
   legacy Get Tickets block). No follow-up was filed: nothing here grew with
   data, and a real event page carries one signup form, not two. Series
   coverage later added per-occurrence queries to both forms, since
   removed for dates without a limit; see finding 2.

5. **Fixed: Query Loop layouts of the events list queried twice per
   rendered post — query-count cost.** The block's empty-site cost is +6
   queries (feature page, `fair-events`). The
   [scaling sweep](#events-list-scaling) found two queries per post rendered
   through a Query Loop layout: 407 list queries for 200 posts, and 26 for
   the bundled pattern's 10. They now take two queries in all (9 and 8). The
   per-event layout and a recurring series up to 100 occurrences had no
   growing query
   ([#1669](https://github.com/marcin-wosinek/fair-event-plugins/issues/1669)).

6. **Running the whole stack costs ~2 MB of peak memory and up to 14 extra
   queries on the plain page — global bootstrap cost.** No single plugin
   moves peak memory alone, but `production-stack` reaches 10 MB on every
   page with blocks, and adds 11 queries on the plain page
   (`production-stack+experimental`: 14), where no plugin's blocks are
   present. This is cumulative bootstrap cost from running many plugins
   together, so no single-plugin follow-up is attributable — noted here as
   context for future measurements rather than a fix target.
