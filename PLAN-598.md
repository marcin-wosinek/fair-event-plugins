# Plan: Activity option price derived from active sale period (#598)

## Background

`TicketOption` (the "activity option") currently stores a single `price`
on the `wp_fair_events_ticket_options` row. We want an opt-in mode where
that price is computed on read from the currently active
`TicketSalePeriod` for the event date, mirroring how ticket-type pricing
already works via `TicketPrice` (`ticket_type_id`, `sale_period_id`).

Key call sites that read `$option->price` today:
- `fair-audience/src/blocks/event-signup/render.php:424` — frontend display.
- `fair-audience/src/API/EventSignupController.php:905` — signup/checkout pricing
  (`compute_option_price`).
- `fair-audience/src/Hooks/PaymentHooks.php:318` — payment line totals.
- `fair-audience/src/API/EventParticipantsController.php:617` — admin
  participants view.
- `fair-events/src/API/TicketsController.php` — admin editor read/write.

## Open question (flag during review)

`TicketSalePeriod` itself carries no price column — for ticket types the
period+price pair lives in `TicketPrice`. To "derive from the active sale
period" we need a per-(option, period) price store.

**Proposed:** add a sibling table `wp_fair_events_ticket_option_prices`
keyed (`ticket_option_id`, `sale_period_id`, `price`), mirroring
`TicketPrice`. Editor shows a price-per-period grid for the option when
the toggle is ON.

Alternative: a single "active-period multiplier" or reusing
`TicketPrice` of a designated ticket type — both feel like the wrong
shape. Confirm the new-table approach before schema work begins.

## Tasks

### 1. Schema
- Add `derive_price_from_sale_period TINYINT(1) NOT NULL DEFAULT 0` to
  `wp_fair_events_ticket_options` in
  `fair-events/src/Database/Schema.php::get_ticket_options_table_sql()`.
- Add new table `wp_fair_events_ticket_option_prices` (
  `ticket_option_id`, `sale_period_id`, `price DECIMAL(10,2)`,
  PK on the pair, FK-ish index on both columns).
- Bump `Installer` schema version so `dbDelta` picks the column up on
  existing installs.

### 2. Model layer
- Add `derive_price_from_sale_period` field + accessors on
  `TicketOption` (hydrate, `to_array`, `create`, `update`).
- New `TicketOptionPrice` model alongside `TicketPrice` with
  `get_by_option_and_period()`,
  `get_all_by_option_id()`, `upsert()`, `delete_by_option_id()`,
  `delete_by_sale_period_id()`.

### 3. Resolver service
- New `ActivityOptionPriceResolver::resolve( TicketOption $option, int $event_date_id, ?int $participant_id = null, ?string $now = null ): ?float`.
- When the toggle is OFF, return `(float) $option->price`.
- When ON: pick the active `TicketSalePeriod` using the same
  "continues_pricing_period" logic as
  `EventSignupPricing::resolve_price_for_ticket_type()`; look up the
  matching `TicketOptionPrice`. **Fallback behaviour is identical to
  ticket types**: if `continues_pricing_period` is on and now is past
  the last period start, use the last period; otherwise return `null`
  (option not purchasable right now).
- Reuse `EventSignupPricing::apply_discount()` + group-rule lookup so
  group discounts still apply on top of the resolved base price (keeps
  parity with current `compute_option_price` behaviour).

### 4. Call-site audit
Replace every direct `$option->price` read with the resolver:
- `fair-audience/src/blocks/event-signup/render.php`
- `fair-audience/src/API/EventSignupController.php::compute_option_price`
  (resolve before group-discount + invitation-price branches).
- `fair-audience/src/Hooks/PaymentHooks.php` (payment totals).
- `fair-audience/src/API/EventParticipantsController.php` (display only).
- Anywhere `to_array()` output is forwarded to the editor: keep raw
  stored `price` for admin editing, but expose a `resolved_price` field
  for read-only consumers.

### 5. Admin editor
- `fair-events/src/Admin/manage-event/` — add a toggle on each activity
  option row ("Derive price from active sale period").
- When ON: hide/disable the manual price input; render a price grid
  keyed by the event date's sale periods (similar to the existing
  ticket-type price grid).
- Persist via `TicketsController` — extend the options PUT payload with
  the flag and `period_prices: [{ sale_period_id, price }]`.

### 6. Tests
- Resolver unit-ish test: toggle off returns stored price; toggle on
  matches the active period; no active period uses fallback; participant
  with group discount gets discounted price.
- `EventSignupController` checkout total test with toggle ON to confirm
  totals match resolver output.
- Editor save round-trip: toggle persists; period grid persists.

## Out of scope
- Ticket-type pricing changes.
- Storing a derived snapshot anywhere — always resolved live.
- Migrating existing manual prices into the period grid (left to the
  user when they flip the toggle).

Closes #598
