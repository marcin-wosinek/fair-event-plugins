# Manage Event screenshots

`npm run screenshots:manage-event` captures every Manage Event tab of one
populated demo event. It runs on the isolated local test site and needs no
manual navigation. The images are for UX and UI-consistency review.

This first iteration produces English, desktop (1280 × 900, full page)
images of a single scenario. Spanish, tablet/mobile, marketing framing and
more scenarios are planned follow-ups (#2043).

## Generate

```bash
npx playwright install chromium        # once
npm run screenshots:manage-event       # builds, starts and stops the test site
```

For faster iteration on an already running, already built test site:

```bash
npm run test:wp-env:start
npm run screenshots:manage-event -- --reuse
```

The command uses the same lifecycle as `test:e2e:local` (see
[TESTING.md](../TESTING.md#isolated-wordpress-test-lifecycle)). An owned run
refuses to start while the tests instance is already running, and never
overlaps another Playwright run on the same site. Extra arguments are passed
to Playwright, e.g. `-- --reuse --grep "Finance"`. A filtered run cannot be
complete, so it is reported as failed and does not replace `latest`.

The target is the tests port resolved from `.wp-env.json` and
`.wp-env.override.json`, or `WP_BASE_URL` if set. Anything other than
`localhost`, `127.0.0.1` or `[::1]` is refused with exit status 2.

## Output

Everything is written under the gitignored
`e2e/screenshots/output/manage-event/`:

| Path                  | Contents                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `latest/NN-<tab>.png` | The last complete set, e.g. `03-schedule.png`. Filenames are stable across runs.            |
| `latest/index.json`   | Tab, scenario, locale, viewport, revision, WordPress and plugin versions, feature settings. |
| `latest/index.html`   | Contact sheet of all ten images with the same context. Open it in a browser.                |
| `runs/<timestamp>/`   | The current run, including `results/<tab>.json` capture records. Kept for debugging.        |

Each run starts by deleting the previous `runs/`. `latest` is replaced only
when all ten tabs were captured and Playwright exited with status 0, so a
failed run can never mix stale and new images. The images stay local:
publishing them is a separate, deliberate step (and only ever of this
synthetic data, see [TESTING.md](../TESTING.md#ad-hoc-page-screenshots)).

## Demo data and safety

`e2e/mu-plugins/scripts/manage-event-demo.php seed` creates the
**Summer Swing Weekend**: one standalone (non-recurring) event with a public
page and a venue, two sale periods (an ended early bird and a regular one),
two ticket types, two add-ons, two workshops and two program items on the
schedule, eleven paid participants with tickets and workshop choices, one
failed payment, a group with a discount and signup visibility, two scheduled
mailings, a finance budget and three cost entries. All names are invented,
email addresses use the reserved `manage-event-demo.example.test` domain, and
payments are written as rows: no payment is ever initiated.

Dates are offsets from the day of the run: the event starts in 12 days and
sales cover the weeks before it. Statistics charts only the four weeks before
the event up to today, so fixed dates would leave its charts empty. Runs on
the same day produce the same screens; the dates in the images move with the
run day.

Before seeding, the fixture stops unless all of these hold:

- outgoing mail is captured by `e2e/mu-plugins/fair-e2e-support.php`;
- Mollie is served by the HTTP double in `e2e/mu-plugins/lib/`;
- the external HTTP guard (`e2e/mu-plugins/fair-e2e-external-http-guard.php`)
  refuses WordPress requests to non-local hosts;
- the payment mode is `test` and the site URL is local.

The browser is likewise limited to the test site, and avatars are switched
off so nothing is fetched from Gravatar. The seed first removes any earlier
demo (found by the `_fair_e2e_manage_event_demo` post meta, the reserved
email domain and the `Demo:` names), and the spec removes the demo again
when it finishes, so repeated or interrupted runs never accumulate records.

The spec switches the site and the `admin` user to English, turns on the
feature bundles listed below and avatars off, and puts all of them back
afterwards. Admin notices outside Manage Event (the test site's unconfigured
Mollie OAuth credentials, for example) are hidden in the images.

## Tabs and their prerequisites

The demo is viewed as an administrator, with every plugin in `.wp-env.json`
active.

| #   | Tab           | Registered by              | Offered when                                                                                                                                         |
| --- | ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Event Details | fair-events                | Always.                                                                                                                                              |
| 2   | Prices        | fair-events                | Fair Events **Ticketing** feature on. Disabled for a generated series occurrence or a link-only event.                                               |
| 3   | Schedule      | fair-events-experimental   | Fair Events Experimental active, Ticketing on, and the event's **Workshop schedule** enabled (Prices → More options).                                |
| 4   | List          | fair-events                | Ticketing on. Disabled for a link-only event.                                                                                                        |
| 5   | Groups        | fair-audience-experimental | Both Experimental plugins and Fair Audience active; Ticketing, Experimental **Ticketing extensions**, **Groups** and **Manage Event extensions** on. |
| 6   | Audience      | fair-audience              | Fair Audience active.                                                                                                                                |
| 7   | Mailings      | fair-audience-experimental | Fair Audience and Fair Audience Experimental active; Experimental **Mailings** and **Manage Event extensions** on.                                   |
| 8   | Statistics    | fair-events                | Fair Audience active, and the viewer can `manage_options`.                                                                                           |
| 9   | Finance       | fair-events                | Fair Finance active.                                                                                                                                 |
| 10  | Admin         | fair-events                | Always.                                                                                                                                              |

## What counts as a capture

The spec first checks that Manage Event offers exactly the manifest's tabs
and none of them is disabled. A missing, disabled or unlisted tab fails the
run and is named in the output.

Each tab is then opened directly with `event_date_id` and its canonical
`tab` parameter. It is captured only when:

- the tab is the selected one;
- the demo data listed under `ready` in the manifest is visible (e.g. the
  first participant on List, both chart areas on Statistics);
- no spinner or error notice remains and no REST request failed or
  returned a 4xx/5xx status;
- web fonts and every image have loaded;
- the page has not changed for half a second, so charts have finished
  animating.

Any failure exits non-zero and prints the affected tab with its reason,
e.g. `tab "finance": Timed out waiting for data`. A setup failure (inactive
plugin, missing protection) is reported against the scenario.

## Troubleshooting

- **`Refusing to seed the Manage Event demo; missing protections: …`**: the
  support mu-plugins are not mounted. Run against the wp-env tests instance,
  never the development stack.
- **`Required plugins are not active`**: the tests instance lost its plugin
  set, e.g. after an interrupted spec that toggles plugins. Run
  `npx wp-env run tests-cli wp plugin activate --all`, or reset it
  ([TESTING.md](../TESTING.md#resetting-leftover-test-data)).
- **A tab fails on its `ready` data**: open
  `test-results/<test>/test-failed-1.png` and the Playwright output. A wording
  change in the UI needs the manifest's `ready` locator updated.
- **The run was interrupted**: the spec could not restore the feature
  options, locale and avatars. Rerun it (the seed cleans up the demo), or
  reset the tests database.

## Adding or changing tab coverage

`e2e/screenshots/manage-event-tabs.js` is the manifest. When a tab is added,
renamed or removed:

1. Update its entry: `name` (the `tab` URL parameter), `title`, `plugin`,
   `prerequisites` and `ready` locators. Keep the entries in tab order; the
   position sets the filename.
2. If the tab is registered from a new file, add the file to `TAB_SOURCES`.
3. Extend `manage-event-demo.php` so the tab has realistic data, enable any
   new feature bundle in the spec's `FEATURE_OPTIONS`, and document the
   prerequisite in the table above.
4. Run `npm run test:tooling`. Its manifest test fails until the manifest
   matches the tabs registered in `TAB_SOURCES`.
5. Run the command twice and review every image.
