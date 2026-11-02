# Payment history migration contract

This contract covers the migration that makes Fair Events own ticket purchases
and their payment history (#2111). It is the output of stage 1 (#2137). Stages
2–5 implement it:

| Stage | Issue | Delivers                                      |
| ----- | ----- | --------------------------------------------- |
| 1     | #2137 | This contract: inventory, rules, examples     |
| 2     | #2138 | Events-owned storage and compatibility        |
| 3     | #2139 | Historical backfill and reconciliation        |
| 4     | #2140 | Payment lifecycle write cutover               |
| 5     | #2141 | Reader cutover and Fair Audience independence |

Each section is marked as one of:

- **Implemented:** what the code on `main` does today, with file paths.
- **Compatibility:** scaffolding that exists only to bridge plugin versions or
  storage generations.
- **Contract:** behaviour later stages must implement. Where this document
  names tables or columns, the names are indicative. Stage 2 fixes the schema
  but must keep every field and invariant listed here.

Anything this contract doesn't state is not yet decided. A later stage that
needs to decide it records a timestamped `## Decision` comment on its issue
and updates this document in the same pull request.

## Contents

1. [Terms](#1-terms)
2. [Ownership](#2-ownership)
3. [Current inventory](#3-current-inventory)
4. [Admissions](#4-admissions)
5. [Charge attribution and allocation](#5-charge-attribution-and-allocation)
6. [Evidence, unresolved records and reconciliation](#6-evidence-unresolved-records-and-reconciliation)
7. [Revenue display](#7-revenue-display)
8. [Stages, compatibility and recovery](#8-stages-compatibility-and-recovery)
9. [Worked examples](#9-worked-examples)
10. [Verification for later stages](#10-verification-for-later-stages)
11. [Out of scope](#11-out-of-scope)
12. [Gaps found during the inventory](#12-gaps-found-during-the-inventory)

## 1. Terms

- **Purchase:** one `fair_events_signups` row. It records what someone bought
  for one event date. A purchase owns one ticket unit per admission
  (`fair_events_tickets`), and the units own their activity selections
  (`fair_events_ticket_activities`).
- **Admission:** one ticket unit that admits one person. A unit with status
  `confirmed` is an admission. One with `pending_payment` holds a place but
  isn't an admission yet.
- **Relationship:** one `fair_audience_event_participants` row. It records a
  participant's role on an event date (`interested`, `signed_up`,
  `collaborator`, `pending_payment`) and is unique per event date and
  participant. It is not a purchase. Several purchases by one participant on
  one date share one relationship.
- **Legacy admission:** a `signed_up` relationship with no purchase behind it.
  These come from before ticket units existed, from Fair Audience's own
  purchase route, or from an organizer adding a participant by hand.
- **Transaction:** one `fair_payment_transactions` row. Fair Payments
  Connector owns it, together with its line items (`fair_payment_line_items`)
  and its provider status. One transaction is one payment attempt.
- **Transaction total:** the transaction's `amount` and `currency`. Connector
  is authoritative for both.
- **Allocation:** the part of a transaction total that belongs to one purchase.
  The allocations of a transaction never add up to more than its total.
- **Attempt:** a transaction created for a purchase, whatever its outcome. A
  retry is a new attempt.
- **Payment link:** the Events-owned record tying one purchase to one
  transaction, with its role and allocation (§5.1).

## 2. Ownership

**Contract.** Once stage 5 is complete:

| Data                                                     | Owner                   | Notes                                                                       |
| -------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| Purchases, ticket units, activity selections             | Fair Events             | Unchanged; already Events-owned.                                            |
| Purchase ↔ transaction association, role and allocation  | Fair Events             | New payment links (§5.1). Replaces every Audience ledger use for purchases. |
| Amount, currency, provider status, fees, line items      | Fair Payments Connector | Read-only to Events. Never copied as an authoritative value.                |
| Participant profile, purchaser and holder identity       | Fair Audience           | Optional. Events stores participant IDs as plain integers.                  |
| Relationship roles (`interested`, `collaborator`)        | Fair Audience           | Never read as admissions after cutover.                                     |
| Participant fee payments (`fee_payment_id` transactions) | Fair Audience           | Out of scope; untouched.                                                    |

Events may keep a snapshot of the allocated amount and currency on a payment
link, because an allocation is derived data that Connector doesn't store. The
transaction's own status and total are always read from Connector.

## 3. Current inventory

All paths are relative to the repository root. Versions on `main` when this
was written: Fair Events 2.1.0 (DB `3.47.0`), Fair Audience 1.22.0, Fair
Payments Connector 2.7.0 (DB `30.0`).

### 3.1 Storage

| Table                                          | Plugin    | Payment-relevant columns                                                                         | Notes                                                                                                                                                     |
| ---------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fair_events_signups`                          | Events    | `amount`, `status`, `transaction_id`, `payment_expires_at`, `participant_id`, `over_capacity`    | `transaction_id` holds only the **latest** attempt; a retry overwrites it (`EventSignup::update_transaction()`).                                          |
| `fair_events_tickets`                          | Events    | `status`, `purchaser_participant_id`, `holder_participant_id`, `event_date_id`, `ticket_type_id` | One row per admission; status follows the signup (`EventTicket::sync_status_from_signup()`).                                                              |
| `fair_events_ticket_activities`                | Events    | `status`, `expires_at`, `over_capacity`                                                          | Per-ticket activity selections, including add-on holds.                                                                                                   |
| `fair_events_checkout_keys`                    | Events    | Idempotency key → checkout                                                                       | Deleted when stale (`CheckoutKey::delete_stale()`).                                                                                                       |
| `fair_audience_event_participants`             | Audience  | `label`, `payment_expires_at`, `ticket_type_id`                                                  | Relationship. Unique on (`event_date_id`, `participant_id`).                                                                                              |
| `fair_audience_event_participant_options`      | Audience  | `status`, `expires_at`, `ticket_id`                                                              | Participant-scope activity selections. `ticket_id` is set when `TicketHistoryBackfill` carried one over.                                                  |
| `fair_audience_event_participant_transactions` | Audience  | `event_participant_id`, `transaction_id`, `kind` (`charge`/`refund`)                             | The Audience ledger. Unique on (relationship, transaction, kind). Rows are written **when an attempt is created**, not when it's paid.                    |
| `fair_payment_transactions`                    | Connector | `amount`, `currency`, `status`, `event_date_id`, `participant_id`, `metadata`                    | `event_date_id`, `participant_id`, `user_id` and `post_id` can be edited by an administrator (`TransactionsController::update_item()`). `metadata` can't. |
| `fair_payment_line_items`                      | Connector | `name`, `quantity`, `unit_amount`, `total_amount`                                                | No reference to a purchase, ticket or event date. Only the name and amounts.                                                                              |

Deleting a transaction (`fair-payments-connector/src/Services/TransactionDeletionService.php`)
removes it and its line items. It fires no hook, so the Audience ledger rows
and `fair_events_signups.transaction_id` keep pointing at the deleted ID.

### 3.2 Transaction metadata sources

Every event-payment transaction carries a `metadata.source`. These keys are
the only evidence administrators can't edit, so attribution starts from them
(§6.1).

| `source`                        | Created by                                                                                                                        | Purchase evidence in metadata                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `fair-events-get-tickets`       | `GetTicketsController::create_checkout_transaction()` (`fair-events/src/API/GetTicketsController.php`)                            | `signup_id` (one purchase), or `signup_ids` (a shared `multiple_instances` purchase); `event_date_id`, `email`                          |
| `fair-events-get-tickets` retry | `GetTicketsController::retry_payment()`                                                                                           | `signup_ids`, `retry_of_transaction_id`                                                                                                 |
| `fair-audience-signup`          | `EventSignupController::create_signup()` and `create_multi_instance_signup()` (`fair-audience/src/API/EventSignupController.php`) | `participant_id`, `ticket_type_id`, `event_date_id`; `event_participant_ids` for multi-instance; `ticket_option_ids` on the single path |
| `fair-audience-signup` retry    | `EventSignupController::retry_payment()`                                                                                          | `event_participant_id` (one), `retry_of_transaction_id`                                                                                 |
| `fair-audience-activity-addon`  | `EventSignupController::add_activities()` and its retry                                                                           | `event_participant_id`, `ticket_id` (or null), `ticket_option_ids`; `retry_of_transaction_id` on retry                                  |
| `fair-audience-series-upgrade`  | `EventSignupController::maybe_start_series_upgrade_payment()`                                                                     | `event_participant_id`, `ticket_type_id` (the whole-series type)                                                                        |
| (has `fee_payment_id`)          | Fair Audience fees                                                                                                                | Out of scope.                                                                                                                           |

### 3.3 Writers

**Implemented.** Each row lists what the writer changes and where.

| Flow                                   | Entry point                                                                                             | Events writes                                                                                          | Audience writes                                                                                                                                | Connector writes                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Get tickets: free                      | `POST fair-events/v1/get-tickets` → `GetTicketsController`                                              | Signup `confirmed`, units, activities                                                                  | `SignupHookBridge::link_participant()`: participant, relationship `signed_up`, signup `participant_id`, confirmation email                     | —                                                       |
| Get tickets: paid                      | same; `create_checkout_transaction()`                                                                   | Signup `pending_payment` with a 15-minute hold, units, activities; `transaction_id`                    | `link_participant()`: relationship `pending_payment`, ledger `charge` at creation; `link_transaction()` → `TransactionParticipantLink::link()` | Transaction, line items                                 |
| Get tickets: shared multi-instance     | `GetTicketsController` multi-instance path                                                              | One signup per occurrence, each with its own `amount`; one transaction for all                         | One relationship and one ledger row per occurrence, each pointing at the **whole** transaction                                                 | One transaction                                         |
| Get tickets: paid notification         | Connector `fair_payment_paid` → `fair-events/src/Hooks/PaymentHooks.php::handle_payment_paid()`         | `EventSignup::confirm_paid()`, capacity recheck, `over_capacity`; fires `fair_events_signup_confirmed` | `SignupHookBridge::handle_signup_confirmed()`: relationship `signed_up`, ledger `charge`, confirmation email                                   | Status (via webhook or sync)                            |
| Get tickets: failed notification       | `fair_payment_failed` → `PaymentHooks::handle_payment_failed()`                                         | `EventSignup::fail_pending()`; fires `fair_events_signup_payment_failed`                               | No-op (`handle_signup_payment_failed()`); the relationship stays `pending_payment` until the expiry cron                                       | Status                                                  |
| Get tickets: retry                     | `POST fair-events/v1/get-tickets/retry-payment`                                                         | `update_transaction()` re-points every signup to the new transaction                                   | `link_transaction()` records the new transaction in the ledger                                                                                 | New transaction                                         |
| Get tickets: cancel and start over     | `POST fair-events/v1/get-tickets/cancel-payment`                                                        | `EventSignup::release_for_restart()`: rows `failed`, hold cleared                                      | —                                                                                                                                              | Status sync                                             |
| Get tickets: hold expiry               | Cron `fair_events_cleanup_expired_ticket_signups`                                                       | `EventSignup::expire_pending()` (rows kept, status `expired`)                                          | Cron `fair_audience_cleanup_expired_signups` deletes expired `pending_payment` relationships, guarded by `EventSignup::has_confirmed_signup()` | —                                                       |
| Audience purchase route                | `POST fair-audience/v1/event-signup` (still registered)                                                 | None: **no signup or ticket units**                                                                    | Relationship `pending_payment`/`signed_up`, participant-scope options, ledger `charge` at creation                                             | Transaction                                             |
| Audience purchase paid/failed          | `fair-audience/src/Hooks/PaymentHooks.php::handle_signup_paid()` / `handle_signup_failed()`             | —                                                                                                      | Relationship `signed_up`, ledger `charge`; emails                                                                                              | —                                                       |
| Audience retry                         | `POST fair-audience/v1/event-signup/retry-payment`                                                      | —                                                                                                      | Relationship back to `pending_payment`, options re-held                                                                                        | New transaction                                         |
| Activity add-on                        | `POST fair-audience/v1/event-signup/add-activities`                                                     | Per-ticket activity holds when `ticket_id` is known                                                    | Ledger `charge` at creation; participant-scope holds otherwise                                                                                 | Transaction                                             |
| Activity add-on paid/failed            | `PaymentHooks::handle_activities_added_paid()` / `handle_activities_added_failed()`                     | `EventTicketActivity::confirm()` / `release_holds()`, `over_capacity`                                  | `add_options()` / `release_pending_options()`; email                                                                                           | —                                                       |
| Series upgrade                         | `EventSignupController::maybe_start_series_upgrade_payment()` (on `POST fair-audience/v1/event-signup`) | —                                                                                                      | Ledger `charge` at creation                                                                                                                    | Transaction                                             |
| Series upgrade paid                    | `PaymentHooks::handle_series_upgrade_paid()`                                                            | —                                                                                                      | Relationship `ticket_type_id` → whole-series type, ledger `charge`; email                                                                      | —                                                       |
| Administrator moves / retypes a signup | `fair_events_signup_moved` / `fair_events_signup_ticket_type_changed`                                   | Signup and active units                                                                                | `SignupHookBridge::handle_signup_moved()` / `handle_signup_ticket_type_changed()` follow the relationship                                      | —                                                       |
| Participant link repair                | `fair-audience/src/Services/TransactionParticipantRepair.php` (upgrade routine)                         | —                                                                                                      | Ledger rows, transaction `participant_id`                                                                                                      | `participant_id`                                        |
| Participant backfill                   | `SignupHookBridge::backfill_signup_participant_ids()`                                                   | Signup `participant_id` **by email match**, unit purchaser/holder                                      | —                                                                                                                                              | —                                                       |
| Participant anonymization              | `EventSignup::anonymize_by_participant_id()`                                                            | Signup name/email cleared, `participant_id` nulled                                                     | —                                                                                                                                              | —                                                       |
| Transaction deletion                   | `DELETE fair-payments-connector/v1/transactions/{id}`                                                   | — (dangling `transaction_id`)                                                                          | — (dangling ledger rows)                                                                                                                       | Deletes transaction and line items                      |
| Transaction edit                       | `PUT fair-payments-connector/v1/transactions/{id}`                                                      | —                                                                                                      | —                                                                                                                                              | `participant_id`, `event_date_id`, `post_id`, `user_id` |

### 3.4 Readers

| Reader                                                              | Path                                                                                                                                                                        | Reads                                                                                                          | Depends on Audience?                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Statistics REST (`fair-events/v1` and the `fair-audience/v1` alias) | `fair-events/src/API/EventStatisticsController.php`                                                                                                                         | Revenue: `signed_up` relationships → ledger → paid transactions. Tickets: `EventTicketStatistics`.             | **Yes.** The route isn't registered without Audience (`fair-events/src/Core/Plugin.php`, `is_available()`). |
| Statistics page and Manage Event tab                                | `fair-events/src/Admin/event-statistics/`, `AdminPages.php` (`statisticsAvailable`, `audienceActive`)                                                                       | The REST route above                                                                                           | **Yes**, hidden without Audience                                                                            |
| Ticket statistics                                                   | `fair-events/src/Services/EventTicketStatistics.php`                                                                                                                        | Units, unbackfilled signups, legacy relationships, participant-scope options                                   | Optional: reads Audience tables directly                                                                    |
| Capacity                                                            | `fair-events/src/Services/TicketCapacity.php`                                                                                                                               | Units plus the `fair_events_capacity_legacy_admissions` and `..._legacy_activity_selections` filters           | Optional, via filters                                                                                       |
| Capacity statistics                                                 | `fair-events/src/Services/EventCapacityStatistics.php`                                                                                                                      | `TicketCapacity`                                                                                               | Optional                                                                                                    |
| Manage Event: Finance                                               | `fair-events/src/Admin/manage-event/EventFinance.js`                                                                                                                        | `fair-payments-connector/v1/transactions?event_date_id=…` (the editable column)                                | No; Connector only                                                                                          |
| Manage Event: signups list and export                               | `EventSignups.js`, `SignupExportModal.js` → `GET fair-events/v1/get-tickets`                                                                                                | Signup `transaction_id` (latest attempt only)                                                                  | No                                                                                                          |
| Signup block: payment callback and state                            | `fair-events/src/blocks/event-signup/render.php`, `Services/SignupPaymentState.php`, `SignupPaymentSession.php`                                                             | `EventSignup::get_all_by_transaction_id()`, the session cookie, the Connector transaction                      | No                                                                                                          |
| Retry and cancel                                                    | `GetTicketsController::retry_payment()` / `cancel_payment()`                                                                                                                | `EventSignup::resolve_signup_ids_from_transaction()`, which requires `signup.transaction_id` = the transaction | No                                                                                                          |
| Participant detail: events and payment status                       | `fair-audience/src/API/ParticipantsController.php`                                                                                                                          | Ledger `get_latest_charge_transaction_ids()` per relationship                                                  | Audience-owned                                                                                              |
| Audience upgrade price                                              | `EventSignupController::maybe_start_series_upgrade_payment()`                                                                                                               | `get_net_paid()`: every paid ledger charge on the relationship                                                 | Audience-owned                                                                                              |
| Audience resume and retry                                           | `EventSignupController::get_resume_payload()` / `retry_payment()`                                                                                                           | Ledger, relationship                                                                                           | Audience-owned                                                                                              |
| Connector notifications (email, Telegram)                           | `fair-payments-connector/src/Hooks/NotificationHooks.php` → `fair_payment_notification_context` → `fair-audience/src/Hooks/PaymentHooks.php::enrich_notification_context()` | Ledger → relationship → event, ticket type, activities, discount                                               | Enrichment only                                                                                             |
| Connector transaction view                                          | `TransactionsController` → `fair_payment_prepare_event` (Events), `fair_payment_prepare_participant` (Audience)                                                             | Transaction `event_date_id`, `participant_id`                                                                  | Participant only                                                                                            |
| Purchase confirmation emails                                        | `SignupHookBridge::send_purchase_confirmation()`, `fair-events/src/Hooks/SignupEmailHooks.php`, Audience `EmailService`                                                     | Signup, units, activities, relationship                                                                        | Audience sends when active                                                                                  |

### 3.5 Cross-plugin hooks

The migration must keep these hooks, or deprecate them in a documented way.
They're the integration surface ([RELEASES.md § Cross-plugin interface changes](./RELEASES.md)).

- Connector actions: `fair_payment_paid`, `fair_payment_failed`,
  `fair_payment_status_changed`.
- Connector filters: `fair_payment_prepare_event`,
  `fair_payment_validate_event_date_id`, `fair_payment_prepare_participant`,
  `fair_payment_resolve_participant_id`, `fair_payment_notification_context`.
- Events actions: `fair_events_signup_created`,
  `fair_events_signup_transaction_created`, `fair_events_signup_confirmed`,
  `fair_events_signup_payment_failed`, `fair_events_signup_moved`,
  `fair_events_signup_ticket_type_changed`,
  `fair_events_backfill_signup_participant_ids`.
- Events filters: `fair_events_signup_transaction_participant_id`,
  `fair_events_capacity_legacy_admissions`,
  `fair_events_capacity_legacy_activity_selections`.

## 4. Admissions

`SignupHookBridge::filter_legacy_admissions()` →
`EventParticipantRepository::count_admissions_without_signup()` is the
reference for which relationships count as admissions today.
`EventTicketStatistics::get_relationships_without_signup()` implements a
slightly different rule (§12, gap G3). The contract below reconciles the two.

### 4.1 Which historical records become admissions

**Contract.** Stage 3 creates Events purchases only for legacy admissions. A
relationship is a legacy admission when all of these hold:

1. `label = 'signed_up'`.
2. The participant has no **active** purchase (status `confirmed`, or
   `pending_payment` with an unexpired hold) on the same event date. For a
   relationship with a ticket type, the participant also has no active
   purchase of that ticket type. A purchase that `failed` or `expired` never
   stands in for a relationship.
3. The participant holds no active ticket unit on that date as holder
   (`holder_participant_id`), so a ticket assigned to them by another
   purchaser isn't counted twice.

Never an admission:

- `interested` and `collaborator` relationships. A collaborator who also
  bought a ticket already has a purchase.
- `pending_payment` relationships, expired or not. An unexpired hold belongs
  to a payment in flight; the live writers resolve it. The backfill leaves it
  alone and re-examines it on its next pass (§8.3), once the hold has resolved.
- A relationship whose participant was anonymized: the relationship is kept,
  but a purchase created for it carries no name or email.

### 4.2 Shape of a backfilled purchase

**Contract.** Each legacy admission becomes exactly one purchase:

| Field                       | Value                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `event_date_id`             | The relationship's event date. For a whole-series pass, that's the series master, as Audience stores it.   |
| `ticket_type_id`            | The relationship's `ticket_type_id`, or null.                                                              |
| `quantity`                  | 1. A relationship has always stood for one admission.                                                      |
| `status`                    | `confirmed`.                                                                                               |
| `participant_id`            | The relationship's participant. It is purchaser and holder of the single unit.                             |
| `name`, `email`             | Copied from the participant profile at backfill time; empty when anonymized.                               |
| `amount`                    | The sum of the allocations given to it (§5); 0 when it has no attributed charge.                           |
| `created_at`                | The relationship's `created_at`. The original time is preserved.                                           |
| `attended_at` (on the unit) | The relationship's `attended_at`, unless `TicketHistoryBackfill` already copied it onto a ticket.          |
| Provenance                  | A backfill marker naming the source relationship ID, so a re-run finds it instead of creating another one. |

The backfilled purchase doesn't replace the relationship. The relationship
stays for Fair Audience's own features.

### 4.3 Duplicates

**Contract.**

- A relationship produces at most one backfilled purchase. The provenance
  marker is the idempotency key: a re-run that finds it updates nothing and
  creates nothing.
- Once a relationship has a backfilled purchase, criterion 2 in §4.1 is met
  by that purchase, so neither the capacity nor the statistics legacy filter
  counts it again. Stage 2 must therefore exclude backfilled relationships
  from both filters before stage 3 writes any purchase.
- Two relationships of the same participant on different dates are two
  admissions. The only exception is when one is the series master and the
  other a generated occurrence of the same whole-series pass. Then the pass
  is the admission and the occurrence relationship is reported as
  `duplicate_series_relationship`; it isn't backfilled.

### 4.4 Activities

**Contract.** Participant-scope activity selections
(`fair_audience_event_participant_options` with `ticket_id IS NULL`) are
attributed to a ticket only when the relationship has exactly one candidate
ticket on that date:

- the backfilled purchase's single unit, when the relationship was a legacy
  admission; or
- the one active unit the participant holds there, which is the rule
  `TicketHistoryBackfill` already applies.

With zero or several candidates the selection stays at participant scope and
is reported as `ambiguous_activity`. Statistics keeps reporting it as
"tickets without activity assignment", as today. The option's name is
snapshotted from `ticket_option_name`. A selection already carried over
(`ticket_id` set) is never copied twice.

### 4.5 Recurring events

**Implemented.** A whole-series purchase is stored on the series master. It
counts as a ticket on every occurrence that starts at or after the purchase
(`EventTiming::series_pass_cutoff()`), in both `TicketCapacity` and
`EventTicketStatistics`.

**Contract.** Backfilled purchases follow the same rule, using the
relationship's `created_at` as purchase time. A series upgrade (§5.6) changes
the purchase's ticket type to the whole-series type from the moment the
upgrade was paid. The cutoff is evaluated against the upgrade's paid time, so
an upgrade doesn't reach back to occurrences that had already started.

### 4.6 Purchaser and holder

**Contract.** Purchaser identity comes from the purchase
(`fair_events_signups.participant_id` and the units'
`purchaser_participant_id`). Holder identity comes from each unit. A
relationship never decides either one once a purchase exists. A purchase
without a participant is valid: Events must not need Audience to know who
bought it.

`SignupHookBridge::backfill_signup_participant_ids()` matches participants by
email. Stage 3 must not use that as attribution evidence (§6.1). It may keep
running as the existing profile link, but a purchase's payment attribution
never depends on it.

## 5. Charge attribution and allocation

### 5.1 Payment links

**Contract.** Events stores one payment link per (purchase, transaction,
role):

| Field              | Meaning                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `signup_id`        | The purchase.                                                                                                                               |
| `transaction_id`   | The Connector transaction. Not a foreign key: Connector may be inactive or the transaction may have been deleted.                           |
| `role`             | `charge` (the purchase price), `additional_charge` (activities added later), `upgrade` (a series upgrade), or `legacy_refund_record` (§11). |
| `allocated_amount` | This purchase's part of the transaction total, in the transaction's currency.                                                               |
| `currency`         | A copy of the transaction currency when the link was written.                                                                               |
| `attribution`      | `live` (written by the lifecycle), `backfill` (written from deterministic evidence), or `reconciled` (written by an administrator).         |
| `evidence`         | What established the link (§6.1).                                                                                                           |
| `created_at`       | When the attempt was created. For backfilled links, the transaction's `created_at`.                                                         |

Invariants:

- Unique on (`signup_id`, `transaction_id`, `role`). Writing the same link
  twice is a no-op.
- For every transaction, the sum of `allocated_amount` across its links is
  at most the transaction total. Equality means the transaction is fully
  attributed; anything less leaves an `unallocated_remainder` that is
  reported (§6.2).
- Links are written for every attempt, including failed ones, so the payment
  history of a purchase is complete. Only links whose transaction has
  Connector status `paid` count as revenue.
- `fair_events_signups.transaction_id` keeps its current meaning, "latest
  attempt", for the retry, cancel and session flows. It is never the payment
  history.

### 5.2 Transaction totals versus allocations

**Contract.** Readers never sum transaction totals per purchase or per date.
They sum `allocated_amount` over paid links. The transaction total appears
only where the transaction itself is shown (Connector screens, the Finance
tab's transaction lists). Statistics shows allocations.

A shared transaction is never assigned in full to more than one purchase.
Today each occurrence of a shared purchase records the whole transaction in
its relationship's ledger, so each occurrence's Statistics shows the full
amount (§12, gap G1). Allocations fix this.

### 5.3 Single-purchase transactions

**Contract.** A transaction whose evidence names exactly one purchase gets
one link with `allocated_amount` = the transaction total. When the purchase's
own `amount` differs from that total, the link is still written: Connector is
authoritative, and with one purchase there is no one else to give the money
to. The difference is reported as `amount_mismatch` for review.

### 5.4 Shared transactions

**Contract.**

- `fair-events-get-tickets` with `signup_ids`: each named purchase is
  allocated its own `fair_events_signups.amount`. The checkout wrote that
  amount from the same line items as the transaction, one line per
  occurrence. When the amounts add up to the transaction total (compared with
  `LineItemTotals` rounding), every link is written. When they don't, nothing
  is written and the transaction is reported as `allocation_mismatch`.
- `fair-audience-signup` with `event_participant_ids`: the backfilled
  purchases for those relationships share the transaction. Allocation uses
  the line items: one line per relationship, identical totals, adding up to
  the transaction total. Then each purchase gets one line's total. Any other
  shape is reported as `allocation_mismatch`. Line items name no occurrence,
  so equal lines are the only shape that can be split without guessing.

### 5.5 Retries and late payments

**Implemented.** A get-tickets retry creates a new transaction whose metadata
names the same `signup_ids` and `retry_of_transaction_id`. It re-points
`fair_events_signups.transaction_id` to the new attempt.
`resolve_signup_ids_from_transaction()` then resolves nothing for the old
attempt, so a late `paid` notification for an old attempt confirms no
purchase. An Audience retry creates a new transaction with a single
`event_participant_id`.

**Contract.**

- Every attempt gets its own links, with the allocation the attempt would
  have had. Attempts are told apart by their Connector status, and only paid
  ones count.
- The `retry_of_transaction_id` chain is kept in the evidence, so a
  purchase's history lists its attempts in order.
- When more than one attempt for the same purchase and role ends up `paid`,
  each paid attempt is real money received. All of them count as revenue,
  and the purchase is reported as `multiple_paid_attempts` so the organizer
  can act. This contract doesn't define a refund for it (§11).
- Stage 4 makes the paid handler resolve the purchase from payment links,
  not from `signup.transaction_id`. A late payment for an older attempt is
  then honoured like any other, matching what `confirm_paid()` already does
  for a released purchase.

### 5.6 Additional charges and upgrades

**Contract.**

- **Activity add-on** (`fair-audience-activity-addon`): a link with role
  `additional_charge` and `allocated_amount` = the transaction total, on the
  purchase that owns `metadata.ticket_id`. When `ticket_id` is null, use the
  relationship's backfilled purchase if it has one. Otherwise, use the
  participant's single active purchase on that date. Zero or several
  candidates: report `ambiguous_activity_charge`.
- **Series upgrade** (`fair-audience-series-upgrade`): a link with role
  `upgrade` on the purchase that the upgraded relationship represents: its
  backfilled purchase, or else the participant's single active purchase on
  that master date. Zero or several: report `ambiguous_upgrade`. The upgrade
  allocation is the upgrade transaction's total. The purchase's original
  `charge` link stays as it was. The purchase's revenue is the sum of both.
- The price of a future upgrade is the series price minus the purchase's own
  paid allocations, **not** the relationship's net paid. Today
  `get_net_paid()` sums every charge on the relationship, including those of
  other purchases on the same date (§12, gap G4).

### 5.7 Currency

**Implemented.** Statistics leaves out transactions whose currency isn't the
site currency and lists them in `excluded_currencies`.

**Contract.** Links keep their transaction's currency. Revenue sums are per
currency. Readers keep excluding, and listing, currencies other than the site
currency. Allocations are never converted between currencies.

## 6. Evidence, unresolved records and reconciliation

Matching is deterministic and evidence-based. Heuristic matching that
silently assigns ambiguous history is rejected.

### 6.1 Evidence for automatic attribution

**Contract.** The backfill may write a link only from evidence on this list.
Each link records which item it used.

| Evidence                                                                                                                                                                                  | Establishes                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `metadata.source = fair-events-get-tickets` and `metadata.signup_id` / `signup_ids`, each naming an existing purchase                                                                     | Purchase ↔ transaction (any attempt)                                                                                                   |
| The oldest get-tickets transactions without those keys: the single purchase whose `transaction_id` equals the transaction (the existing `resolve_signup_ids_from_transaction()` fallback) | Purchase ↔ transaction                                                                                                                 |
| `metadata.source = fair-audience-signup` with `event_participant_ids` or `event_participant_id`, and the Audience ledger row for the same relationship and transaction                    | Relationship ↔ transaction; then purchase via §4                                                                                       |
| `metadata.source = fair-audience-activity-addon` / `fair-audience-series-upgrade` with `event_participant_id` (and `ticket_id`)                                                           | As §5.6                                                                                                                                |
| An Audience ledger row whose transaction has no recognised `source`                                                                                                                       | Only when that ledger row is the only link for the transaction and its relationship maps to exactly one purchase; otherwise unresolved |
| `metadata.retry_of_transaction_id`                                                                                                                                                        | Attempt order only; never the purchase by itself                                                                                       |

Never sufficient on its own: participant ID, email, event date, amount,
creation time, or any combination of them. Neither are the editable
transaction columns (`event_date_id`, `participant_id`, `post_id`,
`user_id`). They may be shown to an administrator during reconciliation as
hints.

### 6.2 Unresolved records

**Contract.** The backfill reports every record it couldn't attribute,
grouped by reason, with the source IDs. It doesn't write a partial link for
it. Reasons:

| Reason                              | Meaning                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `no_evidence`                       | An event-payment transaction (recognised source, or an Audience ledger row) with no purchase reachable through §6.1. |
| `allocation_mismatch`               | A shared transaction whose purchases or line items don't add up to its total (§5.4).                                 |
| `amount_mismatch`                   | A single purchase linked, but its own amount differs from the transaction total (§5.3). Informational.               |
| `ambiguous_activity`                | A participant-scope activity with zero or several candidate tickets (§4.4).                                          |
| `ambiguous_activity_charge`         | An add-on charge with zero or several candidate purchases (§5.6).                                                    |
| `ambiguous_upgrade`                 | An upgrade charge with zero or several candidate purchases (§5.6).                                                   |
| `duplicate_series_relationship`     | A generated-occurrence relationship duplicating a series pass (§4.3).                                                |
| `multiple_paid_attempts`            | More than one paid attempt for one purchase and role (§5.5). Informational.                                          |
| `missing_transaction`               | A purchase, ledger row or link naming a transaction that no longer exists in Connector.                              |
| `currency_mismatch`                 | Purchases sharing one transaction recorded in different currencies.                                                  |
| `unsupported_refund_record`         | A ledger row with `kind = 'refund'` (§11).                                                                           |
| `participant_relationship_conflict` | A transaction recorded in the ledger against relationships of different participants.                                |

Unresolved records keep their source rows. Nothing is deleted to make a
report shorter.

### 6.3 Reconciliation

**Contract.**

- Only administrators (`manage_options`) can reconcile. The REST routes live
  under `fair-events/v1` and follow
  [REST_API_BACKEND.md](./REST_API_BACKEND.md): `WP_REST_Controller`, a
  `*_permissions_check` that returns 401 or 403, and no manual nonce checks.
- An administrator can link a reported transaction to a purchase, set the
  allocations of a shared transaction, remove a reconciled link, or mark a
  record as reviewed with no link. The same allocation invariant applies
  (§5.1): the total can't be exceeded.
- Every reconciliation action appends an audit record with the actor (user
  ID), timestamp (UTC), the reason it resolves, the evidence or note the
  administrator entered, and the link state before and after. Audit records
  are append-only.
- Reconciled links have `attribution = reconciled`. A backfill re-run never
  overwrites them, and never re-reports a record an administrator marked as
  reviewed.
- The admin UI follows [UI_GUIDELINES.md](./UI_GUIDELINES.md): it names the
  purchase and transaction being linked and shows the amounts on both sides.
  Confirmations use the plugin's own dialogs, never native popups.

## 7. Revenue display

### 7.1 Available, incomplete and unavailable

**Contract.** Statistics reports revenue in one of three states, and the API
says which one:

| State         | When                                                                                                              | Display                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `available`   | Connector can be read and every paid transaction reachable for this date is fully allocated.                      | The total.                                                                                                                    |
| `incomplete`  | Connector can be read, but some paid transactions for this date are unresolved, or have an unallocated remainder. | The allocated total, marked incomplete, with the count of unresolved records and a link to reconciliation for administrators. |
| `unavailable` | Connector is inactive, or its table is missing.                                                                   | No amount: "Revenue isn't available because payment information can't be read." Never 0.                                      |

Zero revenue (every purchase free, or nothing sold) is `available` with
total 0. This keeps "no payment information" apart from "no revenue" (#2111).

"Reachable for this date" means: paid transactions linked to purchases on the
date, plus unresolved transactions whose immutable metadata names this event
date. The editable `event_date_id` column only matters as a hint.

### 7.2 Series passes

**Contract** (decided 2026-11-02 on #2137). A whole-series purchase's
allocated revenue is counted once, on the series master date where it's
stored. A generated occurrence keeps counting the pass's tickets, as today.
It reports the pass revenue covering it as a separate figure, which isn't
added to the occurrence's revenue total. This replaces today's behaviour, in
which each occurrence adds the full pass price. Release notes for stage 5 must
call out the change in occurrence totals.

### 7.3 Daily series

**Contract.** The cumulative revenue chart dates each paid link by the day
its transaction was created. Today that's the ledger row's `created_at`,
which is the attempt's creation time (§3.1) and close to that day. Stage 5
keeps the "creation of the attempt" rule, so historical charts don't move.

## 8. Stages, compatibility and recovery

### 8.1 Authoritative source per stage

| Stage completed | Admissions authority                                                               | Purchase ↔ payment authority                                       | Writers                                                                                                | Readers                                           |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 1 (now)         | Units + Audience legacy filters                                                    | Audience ledger (+ signup `transaction_id` for the latest attempt) | As §3.3                                                                                                | As §3.4                                           |
| 2               | Unchanged                                                                          | Unchanged. Events storage exists but is empty or shadow-written.   | Live writers may also write payment links (shadow writes); the ledger stays authoritative              | Unchanged                                         |
| 3               | Unchanged until verification passes                                                | Unchanged until verification passes                                | Backfill writes links and purchases with `attribution = backfill`; live writers keep writing both      | Unchanged; a verification report compares both    |
| 4               | Units; backfilled purchases replace the legacy filter for backfilled relationships | Events payment links                                               | Lifecycle writes links first. The ledger is still written for older Audience versions (compatibility). | Unchanged                                         |
| 5               | Units only                                                                         | Events payment links                                               | As 4                                                                                                   | Events readers; Statistics works without Audience |

No stage switches authority before its verification gate (§8.4) passes on
that site.

### 8.2 Writes during the backfill

**Contract.**

- The live flows keep running during the backfill. A purchase, attempt or
  status change that happens while the backfill runs is written by the live
  writer: to the ledger, and to links once stage 2 shadow writes are on.
- Before stage 4, a backfill may only add links with `attribution = backfill`
  and backfilled purchases. It never changes or deletes a `live` or
  `reconciled` link, a ledger row, a relationship or a transaction.
- The backfill's cutoff is the highest transaction ID and relationship ID it
  saw when it started (IDs, not timestamps, as in `TicketHistoryBackfill`).
  Records after the cutoff are the live writers' job. A re-run after stage 4
  only re-examines unresolved and previously skipped records.

### 8.3 Checkpoints and idempotency

**Contract.** The backfill follows the existing restartable pattern
(`fair-events/src/Services/TicketBackfill.php`,
`fair-audience/src/Services/TransactionParticipantRepair.php`):

- Its state lives in one option: status, cutoff, cursor, and counts per
  reason. The schema version is separate, so an unfinished backfill never
  blocks a schema migration.
- Work runs in bounded batches, in ID order. The cursor is saved after each
  batch.
- Every write is idempotent through a unique key: the provenance marker for
  purchases, (`signup_id`, `transaction_id`, `role`) for links. Repeating an
  interrupted batch therefore produces the same result.
- A purchase, its units and its links are written in one database
  transaction. Either all of them land or none do.
- When the cursor reaches the cutoff, a verification pass (§8.4) runs. The
  backfill is marked complete only when verification is clean, apart from
  reported unresolved records.

### 8.4 Verification gate

**Contract.** Before stage 4 or 5 switches authority on a site, a
verification report, available to administrators, must show for every event
date:

- Admission count from units and backfilled purchases = the count today's
  `EventTicketStatistics` reports (units + unbackfilled signups + legacy
  relationships).
- Revenue from paid links = the ledger-based revenue, after removing the
  differences this contract introduces on purpose: shared transactions
  (§5.4) and series passes (§7.2). The report lists each difference with its
  cause.
- No paid event-payment transaction is linked to nothing and also missing
  from the unresolved list.
- No purchase has more allocated than any of its transactions' totals.

Any difference outside those listed causes blocks cutover for that site.

### 8.5 Recovery

**Contract.**

- Source history (Audience ledger, relationships, participant-scope options,
  `signup.transaction_id`) is kept read-only until verification passes and a
  separate follow-up issue removes it. This migration never deletes it.
- **Before stage 4 cutover:** recovery means reverting to the previous plugin
  versions. The ledger is still authoritative. Backfilled links and purchases
  are inert to older code, except that backfilled purchases count as
  admissions. So stage 2 must make the legacy filters skip backfilled
  relationships in the same release that the backfill can first create them.
  An older Fair Audience that lacks this check would count them twice; the
  update order (§8.6) prevents that.
- **After stage 4 cutover:** the live writers write links first. Rolling
  back would lose payment history recorded only as links, so recovery is
  **forward repair**: fix the code, re-run the backfill for the affected
  range, reconcile what's left. Stage 4 keeps writing the ledger, so older
  Audience screens stay correct during a repair.
- Deactivating a plugin isn't a rollback. With Audience deactivated, the
  links, purchases and units stay as they were. Reactivating it must not
  change ticket counts or revenue (#2111 acceptance criterion).
- A database backup is required before the stage 3 backfill starts and
  before stage 4 cutover. The `DEPLOYMENT.md` upgrade notes for those stages
  must give the exact tables and options to export.

### 8.6 Supported versions and update order

**Contract.** Compatibility is gated by capability checks
(`method_exists()`/`class_exists()`, as `EventStatisticsController::is_available()`
does today), never by comparing version strings. Stage changesets declare a
version bump for every plugin whose code changed
([RELEASES.md](./RELEASES.md)).

| Combination                   | Must work from                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Events alone                  | Stage 5: Statistics with tickets and capacity, revenue `unavailable`                                            |
| Events + Connector            | Stage 5: Statistics with revenue, no Audience                                                                   |
| Events + Audience             | Every stage; revenue `unavailable`                                                                              |
| Events + Audience + Connector | Every stage                                                                                                     |
| Newer Events + older Audience | Every stage; the older Audience keeps writing the ledger, and Events' shadow or live writes cover payment links |
| Older Events + newer Audience | Every stage; Audience must skip writes that need the newer Events methods                                       |

Update order for each stage release: **Connector first**, then **Events**,
then **Audience**. Events adds storage and readers before Audience changes
what it writes. The stages 3–5 upgrade notes must give the minimum versions
of each plugin, in the format of the existing `DEPLOYMENT.md` upgrade notes.
Versions are filled in when each stage is released. They aren't known yet.

## 9. Worked examples

Amounts are in EUR, the site currency, unless stated otherwise. "Revenue"
means Statistics revenue for the event date named.

| #   | History                                                                                                                                                      | Expected admissions                                                                  | Expected links (role, allocation, status)                        | Expected revenue                                                           | Reported                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| 1   | Free get-tickets purchase, quantity 2, on date A.                                                                                                            | 2 on A                                                                               | None                                                             | A: 0, `available`                                                          | —                               |
| 2   | Paid get-tickets purchase S1, quantity 2 at €15 = T1 €30 paid.                                                                                               | 2 on A                                                                               | S1–T1 charge €30, paid                                           | A: €30                                                                     | —                               |
| 3   | Legacy: relationship R `signed_up` on A, no signup; Audience ledger R–T2 €20 paid (`fair-audience-signup`, `event_participant_id` R).                        | 1 on A (backfilled purchase B(R))                                                    | B(R)–T2 charge €20, paid, `backfill`                             | A: €20                                                                     | —                               |
| 4   | Legacy: R `signed_up` on A added by an organizer, no ledger row.                                                                                             | 1 on A                                                                               | None                                                             | A: 0, `available`                                                          | —                               |
| 5   | R `interested` on A; R2 `collaborator` on A.                                                                                                                 | 0                                                                                    | None                                                             | A: 0                                                                       | —                               |
| 6   | Repeat purchases (`RepeatPurchases.api.spec.js`): participant P buys S1 (T1 €10 paid), then S2 of another type (T2 €25 paid), same date A. One relationship. | S1 + S2 units on A                                                                   | S1–T1 €10; S2–T2 €25                                             | A: €35 (unchanged from today)                                              | —                               |
| 7   | Shared multi-instance purchase on dates A, B, C at €12 each: S_A, S_B, S_C, each `amount` €12, one T3 €36 paid.                                              | 1 each on A, B, C                                                                    | S_A–T3 €12; S_B–T3 €12; S_C–T3 €12                               | A: €12, B: €12, C: €12 (today €36 on each)                                 | —                               |
| 8   | Failed then retried: S1 with T4 €30 failed, retry T5 €30 (`retry_of_transaction_id` T4) paid. `signup.transaction_id` = T5.                                  | Units of S1                                                                          | S1–T4 €30 failed; S1–T5 €30 paid                                 | €30                                                                        | —                               |
| 9   | Like 8, but T4 is later reported paid as well.                                                                                                               | Units of S1                                                                          | S1–T4 €30 paid; S1–T5 €30 paid                                   | €60                                                                        | `multiple_paid_attempts` S1     |
| 10  | Activity add-on: S1 (single unit U1) on A; add-on T6 €8 paid with `ticket_id` U1.                                                                            | Units of S1; activity on U1                                                          | S1–T6 additional_charge €8                                       | A: S1's charge + €8                                                        | —                               |
| 11  | Add-on T7 €8 paid with `ticket_id` null; participant holds two active purchases on A.                                                                        | Unchanged                                                                            | None                                                             | A: allocated total, `incomplete`                                           | `ambiguous_activity_charge` T7  |
| 12  | Series upgrade: legacy R on series master M (single-instance type, T8 €20 paid); upgrade T9 €60 paid to whole-series type.                                   | B(R) on M as a whole-series ticket from T9's paid time; counted on later occurrences | B(R)–T8 charge €20; B(R)–T9 upgrade €60                          | M: €80. Each later occurrence: €0 in its total, €80 as series-pass revenue | —                               |
| 13  | Participant-scope activity on R, and P holds two active units on A.                                                                                          | Unchanged                                                                            | —                                                                | —                                                                          | `ambiguous_activity`            |
| 14  | Connector transaction T10 `fair-events-get-tickets`, `signup_id` 999, but signup 999 no longer exists.                                                       | —                                                                                    | None                                                             | Date in T10's metadata: `incomplete`                                       | `no_evidence` T10               |
| 15  | Connector deactivated; date A has S1 (paid T1).                                                                                                              | 2 on A                                                                               | Kept                                                             | A: `unavailable` (not 0)                                                   | —                               |
| 16  | Ledger row R–T11 where T11 was deleted in Connector.                                                                                                         | B(R) if R is a legacy admission                                                      | None                                                             | Unaffected                                                                 | `missing_transaction` T11       |
| 17  | Backfill interrupted after batch 3 of 10, then resumed.                                                                                                      | Same as an uninterrupted run                                                         | Same, with no duplicate links or purchases                       | Same                                                                       | Same counts                     |
| 18  | Backfill completed, then run again.                                                                                                                          | Unchanged                                                                            | Unchanged                                                        | Unchanged                                                                  | Unchanged                       |
| 19  | During the backfill, participant Q buys S9 (T12 paid) after the cutoff.                                                                                      | Units of S9                                                                          | Written by the live writer (shadow or live), not by the backfill | Counted                                                                    | —                               |
| 20  | Audience multi-instance: R_A, R_B `signed_up`, T13 €24 paid with `event_participant_ids` [R_A, R_B] and two €12 line items.                                  | B(R_A) on A, B(R_B) on B                                                             | B(R_A)–T13 €12; B(R_B)–T13 €12                                   | A: €12, B: €12                                                             | —                               |
| 21  | Like 20, but the line items are one €24 line.                                                                                                                | B(R_A), B(R_B)                                                                       | None                                                             | A, B: `incomplete`                                                         | `allocation_mismatch` T13       |
| 22  | Ledger row R–T14 with `kind = 'refund'`.                                                                                                                     | Unchanged                                                                            | Kept as `legacy_refund_record`, not counted                      | Unchanged by T14                                                           | `unsupported_refund_record` T14 |

Existing specs that already pin parts of this behaviour, to extend rather than
replace in stages 2–5:

- `fair-audience/src/API/__tests__/RepeatPurchases.api.spec.js`: example 6.
- `fair-audience/src/API/__tests__/EventSignupLedgerResolution.api.spec.js`:
  the retry-payment permission boundary that retry resolution in example 8
  relies on.
- `fair-audience/src/API/__tests__/EventSignupHookBridge.api.spec.js`: the
  free and paid bridge flows behind examples 1–3.
- `fair-events/src/API/__tests__/EventStatistics.api.spec.js`: payment
  history and currency exclusion, historical admissions, whole-series counts
  (examples 3, 4, 7 and 12 change its expectations on purpose).

Example 22 describes how an existing ledger row is preserved. It is not a
refund scenario, and no fixture may create a refund lifecycle.

## 10. Verification for later stages

Run locally only the focused specs named here, as
[TESTING.md](./TESTING.md) requires. CI runs the full suites.

- **Stage 2 (#2138):** PHP unit tests for the link invariants (uniqueness,
  allocation never above the total). An API spec showing the legacy filters
  skip backfilled relationships. A spec showing Statistics still answers with
  an older Audience.
- **Stage 3 (#2139):** API specs with fixtures for examples 3, 4, 5, 7, 9, 11,
  13, 14, 16 and 20–22. Rerun and resume specs (examples 17, 18). The
  verification report, including the reasons in §6.2. Reconciliation
  permissions: 401 when anonymous, 403 for a non-administrator, and an audit
  record for each action.
- **Stage 4 (#2140):** specs for free, paid, failed, retried (8, 9),
  cancelled, add-on (10) and upgrade (12) flows, each writing links first.
  Webhook replay produces no duplicates. A late paid notification for an
  older attempt confirms the purchase.
- **Stage 5 (#2141):** `EventStatistics.api.spec.js` for each supported
  combination in §8.6 (example 15), the three revenue states, the series rule
  (§7.2), the standalone Statistics page and chart download. A focused E2E for
  the Statistics page with Audience deactivated, then reactivated, showing
  the same results. The `fair-audience/v1` alias route stays registered.

## 11. Out of scope

- **Refunds.** Refund initiation, purchase-level refund allocation (including
  partial and multi-purchase refunds), and refund notifications aren't
  implemented event-payment workflows, so this migration doesn't create them.
  The Audience ledger describes refunds as future functionality.
  `record()` accepting `kind = 'refund'`, and Statistics subtracting such
  rows, don't amount to a refund lifecycle: nothing in the codebase writes
  one. Connector's provider refund details (`amount_refunded`) and
  settlement-report refunds are existing, separate reporting features, and
  this migration leaves them alone. Any existing refund-labelled ledger row is
  preserved as a `legacy_refund_record` link with its provenance unchanged,
  is not counted as revenue or attributed further, and is reported as
  `unsupported_refund_record`.
- Participant fee payments (`fee_payment_id`) and unrelated Fair Audience
  features.
- Deleting source history (ledger, relationships, participant-scope options).
  That needs a separate follow-up after verification.
- Changing how Connector stores transactions or line items.

## 12. Gaps found during the inventory

These are current behaviours the contract deliberately doesn't carry
forward. They're recorded so later stages fix them on purpose, and so
specs that pin them are updated knowingly.

- **G1. Shared transactions counted in full on each date.** A shared
  multi-instance purchase records the whole transaction against each
  occurrence's relationship, so each occurrence's Statistics shows the full
  amount (`SignupHookBridge::link_participant()`,
  `EventSignupController::create_multi_instance_signup()`). Fixed by §5.4.
- **G2. Series passes counted in full on each occurrence.**
  `EventStatisticsController::get_qualifying_sales_rows()` adds a pass's
  whole ledger to every covered occurrence. Fixed by §7.2.
- **G3. Two rules for legacy admissions.** Capacity
  (`count_admissions_without_signup()`) also counts unexpired
  `pending_payment` relationships and skips assigned holders. Statistics
  (`get_relationships_without_signup()`) does neither. Both skip a
  relationship when the participant has **any** signup on the date, even a
  failed or expired one, so such a relationship is never counted (example: an
  organizer adds a participant whose earlier checkout failed). §4.1 replaces
  both with one rule based on active purchases.
- **G4. Upgrade price from the relationship.** `get_net_paid()` sums every
  paid charge on the relationship, including other purchases on the same
  date, so a second purchase can lower the upgrade price. Fixed by §5.6.
- **G5. Retry history overwritten.** `update_transaction()` replaces
  `signup.transaction_id`, so Events keeps only the latest attempt. Earlier
  attempts survive only in Connector metadata and the Audience ledger. Fixed
  by §5.5.
- **G6. Ledger written before payment.** Ledger rows exist for unpaid and
  failed attempts. Revenue readers filter on `status = 'paid'`. The
  participant detail shows each relationship's latest attempt and its status,
  which may be a failed retry even though an earlier attempt was paid. Links
  keep every attempt and say which ones count (§5.1).
- **G7. Audience multi-instance retry names one relationship.**
  `EventSignupController::retry_payment()` writes a single
  `event_participant_id` for a retry of a multi-instance purchase, so the
  other occurrences aren't named. A paid retry like that is reported as
  `allocation_mismatch`, not guessed (§5.4).
- **G8. Dangling references after transaction deletion.** Deleting a
  transaction fires no hook, so ledger rows and `signup.transaction_id` keep
  the deleted ID. Reported as `missing_transaction` (§6.2).
- **G9. Statistics requires Audience.** The route and the page are
  registered only when `EventStatisticsController::is_available()` finds the
  Audience repositories. Fixed by stage 5.

## Read first for stages 2–5

- [PHP_PATTERNS.md](./PHP_PATTERNS.md): `wpdb::prepare()` with `%i`, PHP
  7.4 minimum for fair-events.
- [REST_API_BACKEND.md](./REST_API_BACKEND.md): permission checks, the
  cross-plugin signup hooks, the canonical signup store.
- [REST_API_USAGE.md](./REST_API_USAGE.md): reconciliation and Statistics
  clients.
- [REACT_ADMIN_PATTERN.md](./REACT_ADMIN_PATTERN.md): the reconciliation
  page.
- [UI_GUIDELINES.md](./UI_GUIDELINES.md): revenue states, confirmations,
  i18n.
- [TESTING.md](./TESTING.md): focused API and E2E runs.
- [DEPLOYMENT.md](./DEPLOYMENT.md): upgrade notes and backups for stages 3–5.
- [RELEASES.md](./RELEASES.md): changesets across plugins.
