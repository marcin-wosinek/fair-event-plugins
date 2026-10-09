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
**8889**, built from production Composer dependencies
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
    `fair-payment/simple-payment`, `fair-audience/fair-form`, and
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
dependencies). Generated by `npm run performance`; do not hand-edit the
tables below — re-run the command and paste its output instead.

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

## Findings

Ranked by measured impact; each was verified past the aggregate table before
being written up here (see the linked issue for the verification detail).

1. **The Event Signup form adds about 33 requests and 500 KB of frontend
   JS/CSS to every event page — frontend asset cost.** All three event pages
   load 36 requests / 520 KB with only `fair-events` active, against 3
   requests / 22 KB on the plain page. The number is the same for the
   48-occurrence series and the 16-option event, so it is the form itself,
   not its data. The built public script of the form lists the block-editor
   component library and the date package among its dependencies, which
   bring React and their own dependency chain onto the public page. The
   mailing signup, Fair Form and payment blocks had the same problem
   ([#1668](https://github.com/marcin-wosinek/fair-event-plugins/issues/1668),
   fixed) and now add 6–9 requests each on the feature page.
   Follow-up: [#1827](https://github.com/marcin-wosinek/fair-event-plugins/issues/1827).

2. **The events calendar and week blocks query per displayed occurrence —
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

3. **An event page costs 80–100 queries, mostly independent of fixture
   size — fixed rendering cost.** With `fair-events` alone the plain page
   takes 26 queries, the options event 82, the mid-series occurrence 94 and
   the series master 101. The 48 occurrences account for at most 19 queries
   (master against the single-date options event), well under one per
   occurrence, so neither the occurrence picker nor the options list has an
   N+1 shape at these sizes. The remaining ~55 queries are the fixed cost of
   five event blocks, two of which are signup forms (Event Signup and the
   legacy Get Tickets block). No follow-up is filed: nothing here grows with
   data, and a real event page carries one signup form, not two.

4. **The events list block's query cost on an empty site is now +6 queries**
   (feature page, `fair-events`), down from the +18 of the first baseline.
   How it grows with the number of events is still open in
   [#1669](https://github.com/marcin-wosinek/fair-event-plugins/issues/1669);
   the `listings` page gives that work a number to compare against.

5. **Running the whole stack costs ~2 MB of peak memory and up to 14 extra
   queries on the plain page — global bootstrap cost.** No single plugin
   moves peak memory alone, but `production-stack` reaches 10 MB on every
   page with blocks, and adds 11 queries on the plain page
   (`production-stack+experimental`: 14), where no plugin's blocks are
   present. This is cumulative bootstrap cost from running many plugins
   together, so no single-plugin follow-up is attributable — noted here as
   context for future measurements rather than a fix target.
