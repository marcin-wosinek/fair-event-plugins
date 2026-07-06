# E2E harness internals

This directory holds the repo-root Playwright suite that runs against the
isolated `@wordpress/env` instance (`:8889`). The general harness — how to run
specs, ports, CI — is documented in [`TESTING.md`](../TESTING.md#isolated-e2e-harness-wordpress-env).
This file documents the **test-only support layer** that lets specs drive flows
which normally depend on external services (payments, email), without touching
any production plugin code.

## Layout

```
e2e/
├── smoke.spec.js                         # harness sanity check
├── support/                              # Playwright fixtures + WP-CLI plumbing (Node side)
│   ├── fixtures.js                       # `seedEvent` fixture with per-test cleanup
│   └── wp-cli.js                         # wpCli / runScript / resetCapturedMail / loginAsAdmin
├── user-flows/                           # functional specs
│   └── ticket-purchase-confirmation.spec.js
└── mu-plugins/                           # mounted into wp-env only (see .wp-env.json)
    ├── fair-e2e-support.php              # auto-loaded mu-plugin (mail capture + Mollie test creds + loads the double)
    ├── lib/
    │   ├── event-factory.php             # composable event-seeding builders
    │   └── mollie-http-double.php        # fake Mollie HTTP transport
    └── scripts/                          # WP-CLI eval-file helpers (NOT auto-loaded — subdir)
        ├── seed-event.php
        ├── cleanup-event.php
        └── signup-state.php
```

`.wp-env.json` maps `wp-content/mu-plugins` → `./e2e/mu-plugins`, so this code
loads **only** inside the Playwright wp-env instance. It is never shipped to
production and never mounted by the dev `docker compose` stack. Anything dropped
directly in `mu-plugins/` is auto-loaded by WordPress; helper scripts live in the
`scripts/` subdirectory precisely so they are **not** auto-loaded and only run
when invoked via `wp eval-file`.

## Capturing email

We assert on outgoing mail without sending it. `fair-e2e-support.php` hooks
`pre_wp_mail` and returns `true` (short-circuiting `wp_mail()`), recording each
message — recipient, subject, body — into the `fair_e2e_captured_mail` option.
Specs read it back via WP-CLI (`signup-state.php` filters it down to the buyer's
mail). No real mail leaves the host, and no MailHog/Mailpit container is needed.

## Intercepting Mollie (the key decision)

Driving a *real* purchase in the isolated env is the hard part, and we
explicitly **do not modify the fair-payments-connector Mollie integration to make it
testable**. The constraints that rule out the obvious approaches:

- The Mollie PHP SDK talks to the network through a raw-cURL adapter that pins
  TLS to a bundled CA (`CURLOPT_SSL_VERIFYPEER` + bundled `cacert.pem`), so a
  DNS/hosts-level MITM of `api.mollie.com` cannot work.
- The SDK is constructed inline (`new MollieApiClient()`), with no hook to
  redirect its endpoint.
- Mollie's hosted checkout page and its payment webhook are unreachable from
  `localhost:8889`.
- Playwright `page.route` only sees browser traffic — it cannot intercept the
  server-side `create_payment` cURL call.

The clean interception point is the SDK's HTTP transport itself.
`lib/mollie-http-double.php` pre-declares
`Mollie\Api\HttpAdapter\CurlMollieHttpAdapter` (the exact class the SDK's adapter
picker instantiates) **before** the vendored `final` class autoloads, so PHP
never loads the real one. The double returns canned responses; the rest of the
SDK — URL building, response decoding, resource hydration — and **all** of the
fair-payments-connector / fair-audience purchase code run unchanged.

Canned behaviour, enough to complete a purchase:

| Request | Response |
| --- | --- |
| `POST /v2/payments` | payment `status: open`, `checkout` link = the request's `redirectUrl` |
| `GET /v2/payments/{id}` | the same payment, `status: paid` |
| `GET /v2/methods` | empty list (no method allowlist applied) |
| `GET /v2/balances…` | empty list (fee capture finds nothing) |

`fair-e2e-support.php` also forces `fair_payment_mode = test` and supplies a
syntactically valid dummy API key via `pre_option_*` filters, so the real
`MolliePaymentHandler` validates and runs against the double.

### How a test purchase flows end to end

1. The spec fills and submits the public event-signup form (real REST call to
   `register_and_signup`), which sets `email_profile` from the "Keep me
   informed" checkbox and creates a `pending_payment` signup + transaction.
2. `initiate_payment` → the double returns an `open` payment whose checkout link
   is the signup **callback URL** (`?fair_payment_callback=true&fair_signup_tx=…`).
3. The frontend redirects the browser there. `event-signup/render.php` calls the
   real `fair_payment_sync_transaction_status`, which fetches the payment → the
   double returns `paid`.
4. That fires the real `fair_payment_paid` → `handle_signup_paid` →
   `fair_audience_event_signup_paid` → `send_signup_confirmation_email` chain.
   The email is captured; the signup row flips to `signed_up`.

No separate "simulate the webhook" step is needed — the production sync-on-
redirect path does it.

## WP-CLI helper scripts

Run against the tests instance, e.g.:

```bash
npx wp-env run tests-cli wp eval-file wp-content/mu-plugins/scripts/seed-event.php paid
npx wp-env run tests-cli wp eval-file wp-content/mu-plugins/scripts/signup-state.php buyer@example.test 12
npx wp-env run tests-cli wp eval-file wp-content/mu-plugins/scripts/cleanup-event.php 41 12
```

Each prints a single `MARKER:{json}` line (`E2E_SEED`, `E2E_STATE`,
`E2E_CLEANUP`) that the spec parses.

- **`seed-event.php <flavour> [json-overrides]`** — creates a published
  `fair_event` (with the event-signup block in its content), an event date, an
  active sale period, and a ticket type in the requested **flavour**. Presets
  compose `lib/event-factory.php`:
  - `free` — a ticket type with no price row.
  - `paid` — adds a `TicketPrice` (default `25.00`; override `{"price":40}`).
  - `paid-with-options` — `paid` plus `TicketOption` rows (override
    `{"options":["dinner","tshirt"]}`).
  - `capacity-1` — a paid ticket type with capacity 1 (sold-out/waitlist).
  - `multiple-instances` — a 3-occurrence weekly series with a
    `multiple_instances` ticket type priced per instance (default `10.00`;
    override `{"price":N}`), `minimum_instances` default `2` (override
    `{"minimumInstances":N}`).

  Emits the event permalink + ids: `flavour`, `eventId`, `eventDateId`,
  `salePeriodId`, `ticketTypeId`, `optionIds`, `occurrenceIds`,
  `minimumInstances`, `price`.
- **`cleanup-event.php <eventId> <eventDateId>`** — deletes a seeded event and
  everything off it (signed-up participants + their option rows, the
  event-participant rows, ticket types/prices/options/sale periods/dates, and
  the post), by id. Emits `E2E_CLEANUP` row counts.
- **`signup-state.php <email> <event_date_id>`** — reports the participant's
  `email_profile`/`status`, the event-participant `label`, and the mail captured
  for that buyer.
- **`get-tickets-state.php <event_date_id>`** — reports the fair-events
  `fair_events_signups` rows (the standalone get-tickets purchase path) with
  each row's status and, when paid, its transaction status + Mollie payment id.
- **`seed-payment-page.php [amount] [description]`** / **`cleanup-payment-page.php <pageId>`**
  — create/delete a published page carrying a simple-payment block (with the
  editor-style UUID `blockId` attribute the payment endpoint matches on);
  cleanup also removes the transactions the page created (matched by
  `post_id`).
- **`transaction-state.php <transaction_id>`** — reports one
  `fair_payment_transactions` row (status, testmode, amount, Mollie id).
- **`seed-pending-signup.php <eventId> <eventDateId> <ticketTypeId> <price> [status]`**
  — writes a stuck `pending_payment` event-signup directly (participant +
  `fair_payment_transactions` row in the given status, default `failed`, +
  `event_participants` row with an unexpired `payment_expires_at`), since the
  Mollie double can't produce a failed/canceled payment by itself. Emits the
  participant id, transaction id, and a real `ParticipantToken`. Pair with
  **`cleanup-transaction.php <transactionId>`** to remove the transaction row
  afterwards (the participant/event_participant rows are covered by
  `cleanup-event.php`).

The event seeded by `seed-event.php` carries the fair-audience event-signup
block by default; pass `{"block":"get-tickets"}` in the JSON overrides to seed
it with the fair-events get-tickets block instead (used by the spec that runs
with fair-audience deactivated).

## Playwright fixture: `seedEvent`

Specs import the fixture instead of inlining WP-CLI helpers:

```js
import { test, expect } from '../support/fixtures.js';

test('…', async ({ page, seedEvent }) => {
	const event = seedEvent('paid-with-options', { options: ['dinner'] });
	await page.goto(event.pageUrl);
	// …
});
```

`seedEvent(flavour, overrides)` runs `seed-event.php` and returns the parsed
`E2E_SEED` payload. It records every event it creates and, in **per-test
teardown**, runs `cleanup-event.php` for each and resets captured mail. So each
call yields a fresh, isolated event — specs run in any order, any number of
times, without colliding or accumulating rows. `support/wp-cli.js` also exports
`loginAsAdmin(page)` for specs that need to drive wp-admin.
