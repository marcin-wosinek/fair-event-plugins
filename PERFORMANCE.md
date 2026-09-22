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

Two synthetic pages are created before the sweep and removed afterward:

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

Every comparison reports the delta from the `wordpress-only` baseline for
median duration, query count, peak memory, request count, and transferred
JS/CSS bytes.

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

The runner always restores whichever plugins were active before it ran and
always deletes its fixture pages in a `finally` block — including after a
thrown error or `SIGINT`/`SIGTERM` — so a failed or interrupted run never
leaves the instance in a different activation state than it found it in.

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

This ticket is measurement and evidence only. Where a comparison surfaces a
material bottleneck, the "Findings" section below names it, attributes it to
bootstrap/query/memory/asset cost, and links a follow-up issue — it does not
change any plugin code to fix it.

## Baseline results

Captured with `npm run performance --samples=5` against a clean, owned
isolated instance (PHP 8.3, WordPress test container, production Composer
dependencies). Generated by `npm run performance`; do not hand-edit the
tables below — re-run the command and paste its output instead.

# Performance audit results

Generated: 2026-09-22T10:56:52.048Z

## plain page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | 56.9 | — | 21 | — | 8.00 | — | 3 | — | 22.1 | — |
| fair-payments-connector | 60.1 | +3.2 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-events | 63.9 | +7.0 ms | 23 | +2 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-platform | 59.1 | +2.2 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience | 59.4 | +2.4 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-timetable | 60.4 | +3.4 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-finance | 58.5 | +1.6 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-payments-connector-experimental | 57.8 | +0.8 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-form | 63.5 | +6.5 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-calendar-button | 59.8 | +2.8 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-events-experimental+deps | 63.9 | +7.0 ms | 23 | +2 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience-experimental+deps | 62.9 | +6.0 ms | 22 | +1 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| production-stack | 78.5 | +21.6 ms | 25 | +4 | 10.00 | +2048.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| production-stack+experimental | 81.0 | +24.1 ms | 26 | +5 | 10.00 | +2048.0 KB | 3 | 0 | 22.1 | 0.0 KB |

## feature page

| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wordpress-only | 59.0 | — | 21 | — | 8.00 | — | 3 | — | 22.1 | — |
| fair-payments-connector | 63.1 | +4.0 ms | 21 | 0 | 8.00 | 0.0 KB | 33 | +30 | 479.8 | +457.7 KB |
| fair-events | 84.4 | +25.3 ms | 39 | +18 | 10.00 | +2048.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-platform | 58.6 | -0.4 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience | 63.3 | +4.3 ms | 22 | +1 | 8.00 | 0.0 KB | 33 | +30 | 479.3 | +457.3 KB |
| fair-timetable | 61.4 | +2.3 ms | 22 | +1 | 8.00 | 0.0 KB | 6 | +3 | 27.2 | +5.1 KB |
| fair-finance | 59.4 | +0.3 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-payments-connector-experimental | 59.2 | +0.1 ms | 21 | 0 | 8.00 | 0.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-form | 67.2 | +8.2 ms | 22 | +1 | 8.00 | 0.0 KB | 33 | +30 | 481.4 | +459.3 KB |
| fair-calendar-button | 59.9 | +0.9 ms | 21 | 0 | 8.00 | 0.0 KB | 6 | +3 | 54.6 | +32.6 KB |
| fair-events-experimental+deps | 85.3 | +26.3 ms | 39 | +18 | 10.00 | +2048.0 KB | 3 | 0 | 22.1 | 0.0 KB |
| fair-audience-experimental+deps | 65.1 | +6.1 ms | 23 | +2 | 8.00 | 0.0 KB | 33 | +30 | 479.3 | +457.3 KB |
| production-stack | 107.3 | +48.2 ms | 42 | +21 | 10.00 | +2048.0 KB | 37 | +34 | 514.2 | +492.1 KB |
| production-stack+experimental | 108.1 | +49.1 ms | 43 | +22 | 10.00 | +2048.0 KB | 37 | +34 | 514.2 | +492.1 KB |

## Findings

Ranked by measured impact; each was verified past the aggregate table before
being written up here (see the linked issue for the verification detail).

1. **Three public blocks each add ~450 KB / ~30 requests of frontend JS —
   frontend asset cost.** `fair-payments-connector`'s simple payment block,
   `fair-audience`'s mailing signup block, and `fair-form`'s Fair Form block
   each independently add roughly 30 requests and 457–459 KB of transferred
   JS on the feature page, and the effect is additive — `production-stack`'s
   +492 KB / +34 requests is essentially the sum of the three. Inspecting
   the actual resource list for the mailing signup block (`wp post` fixture,
   direct Playwright resource-timing capture) shows the cause directly: its
   2 KB `frontend.js` pulls in `@wordpress/components` (271 KB alone) and
   its full dependency chain (React, `@wordpress/data`, `@wordpress/date`,
   etc.) onto the public page, not just the block editor. `fair-timetable`
   and `fair-calendar-button` add only 3 requests / 5–33 KB each for their
   own public blocks, showing this isn't inherent to having a frontend
   script — it's specific to how these three blocks are built.
   Follow-up: [#1668](https://github.com/marcin-wosinek/fair-event-plugins/issues/1668).

2. **The events list block issues ~18 extra database queries when it
   renders — query-count cost.** `fair-events` (and, identically,
   `fair-events-experimental+deps`) shows +18 queries and a +2 MB peak
   memory jump on the feature page, but 0 memory delta and only +2 queries
   on the plain page where the block isn't present. The size and shape of
   the jump (present only when the block renders, roughly proportional to
   items in an "N+1" way rather than a small fixed cost) points at a
   per-item query pattern rather than a single batched query.
   Follow-up: [#1669](https://github.com/marcin-wosinek/fair-event-plugins/issues/1669).

3. **Having several plugins active concurrently costs ~2 MB of peak memory
   and a handful of extra queries even on the plain page — global bootstrap
   cost.** No single plugin shows a peak-memory delta alone, but
   `production-stack` (8 plugins) and `production-stack+experimental` (11
   plugins) both jump from 8 MB to 10 MB and add 4–5 queries on the *plain*
   page, where no plugin's blocks are present. This reads as cumulative
   autoloading/bootstrap cost from running many plugins together rather than
   any one plugin's fault, so no single-plugin follow-up is attributable —
   noted here as context for future measurements rather than a fix target.
