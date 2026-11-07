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

### 8.7 Stage 2 storage and capabilities

**Implemented** (#2138, Fair Events DB `3.49.0`). Stage 2 adds storage and
capability checks only. The storage stays empty: nothing in the live flows
writes payment links yet, and every reader, lifecycle handler, permission,
notification and Audience ledger write is unchanged (§8.1). Stage 3
implements shadow writes for every live writer and turns them on before it
takes its cutoff (§8.8).

**Schema** (`fair-events/src/Database/Schema.php`, created by `dbDelta()` in
`Installer::create_tables()`; no data migration):

- `fair_events_signup_payment_links` (InnoDB): `id`, `signup_id`,
  `transaction_id` (not a foreign key), `role` (`charge`,
  `additional_charge`, `upgrade`, `legacy_refund_record`),
  `allocated_amount DECIMAL(10,2)`, `currency CHAR(3)`, `attribution`
  (`live`, `backfill`, `reconciled`), `evidence` (JSON `TEXT` with a `type`),
  `created_at` (the attempt's creation, copied from the transaction's
  `created_at` unless the writer gives one) and `recorded_at` (when the link
  was written). Unique key `idx_signup_transaction_role` (`signup_id`,
  `transaction_id`, `role`), which also serves purchase lookups; key
  `idx_transaction_id`.
- `fair_events_signups.legacy_event_participant_id`: nullable, unique
  (`idx_legacy_event_participant_id`). It is the provenance marker of §4.2:
  the relationship a backfilled purchase was created from. Ordinary
  purchases leave it null. It is a plain integer, so it survives Audience
  being deactivated, and the purchase's `participant_id` stays optional.

**Interfaces** (all in `fair-events/src/`):

| Class                                  | Use                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Services\PaymentLinks::write()`       | Adds one transaction's links atomically. Holds a named lock per transaction (`GET_LOCK`, `lock_name()`) and a database transaction, so concurrent writers can't exceed the total together. Returns `inserted`/`unchanged` counts, or a `WP_Error`.                                                                                                                            |
| `PaymentLinks::write_in_transaction()` | The same inside a database transaction the caller opened (a purchase, its units and its links together, §8.3). The caller holds `acquire_lock()` until it commits, and rolls back on an error.                                                                                                                                                                                |
| `PaymentLinks::get_for_signup()`       | A purchase's links with each transaction's Connector status. `payment_information` is `unavailable` when Connector can't be read (links still returned, never treated as 0); a deleted transaction has `transaction_missing`.                                                                                                                                                 |
| `Services\PaymentLinkAllocation`       | The pure rules behind `write()`: field validation, `LineItemTotals` rounding compared in cents, a repeated identical link is `unchanged` (the stored row keeps its attribution and evidence), a different one is `payment_link_conflict` and refuses the whole set, and the sum never exceeds the total (`allocation_exceeds_total`).                                         |
| `Models\SignupPaymentLink`             | Table access. Insert only: nothing updates or deletes a link, so a backfill can't change a `live` or `reconciled` one.                                                                                                                                                                                                                                                        |
| `Services\PaymentHistoryCompatibility` | Capability checks, kept separate: `storage_available()` (DB `3.49.0` and the table exist), `purchase_provenance_available()`, `shadow_write_coverage()` (§8.8), `migration_verified()` (`fair_events_payment_history_migration` option status `verified`, set by stage 3), `ownership_cutover()` (the recorded stage 4 activation, §8.11), `payment_information_available()`. |

`write()` errors: `payment_links_unavailable` (schema not upgraded),
`payment_information_unavailable` (Connector inactive or its table missing),
`missing_transaction`, `payment_links_busy` (lock timeout),
`invalid_payment_transaction`, `invalid_payment_link` (with the `field`),
`duplicate_payment_link` (the same purchase and role twice in one set),
`payment_link_conflict`, `allocation_exceeds_total`,
`payment_link_unknown_purchase`, `payment_link_write_failed` (rolled back).
Nothing is written on any error.

**Admissions.** Both legacy filters skip a relationship that a purchase
names as its provenance, whatever that purchase's participant or status:
`EventTicketStatistics::get_relationships_without_signup()` when
`storage_available()`, and Audience's
`EventParticipantRepository::count_admissions_without_signup()` when the
active Events has `PaymentHistoryCompatibility::purchase_provenance_available()`.
The participant/date and ticket-type matching for ordinary purchases is
unchanged, and so is the activity attribution in Statistics. Audience
reports this support with `EventParticipantRepository::excludes_purchase_provenance()`.

**Starting the backfill.** `PaymentHistoryCompatibility::backfill_blockers()`
lists what stops stage 3 from starting: `storage_unavailable`,
`shadow_writes_incomplete`, `payment_information_unavailable` and
`audience_incompatible` (an active Audience without
`excludes_purchase_provenance()`, which would count backfilled
relationships twice, §8.5). Stage 3 must refuse to start while any is
listed. In stage 2 `shadow_writes_incomplete` is always listed; from §8.8
on it is listed until shadow writes record their coverage floors.

**Supported combinations at stage 2** (§8.6):

| Combination                   | Behaviour                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events + Audience + Connector | Unchanged. Storage exists and is empty.                                                                                                                     |
| Events + Audience             | Unchanged. `payment_information_available()` is false; `write()` refuses with `payment_information_unavailable`.                                            |
| Newer Events + older Audience | Works. Events' Statistics skips provenance relationships; the older Audience capacity filter doesn't, so the backfill is blocked (`audience_incompatible`). |
| Older Events + newer Audience | Works. Audience finds no `PaymentHistoryCompatibility` and runs its previous query, never reading the missing column.                                       |
| Events upgrade incomplete     | `storage_available()` is false until DB `3.49.0` is recorded and the table exists; both filters keep their previous queries.                                |

### 8.8 Stage 3 shadow writes

**Implemented** (#2139, first of three pull requests; Fair Events DB
`3.50.0`). Every live payment writer records payment links, and Fair
Audience-only admissions get an Events purchase to link to, while the
ledger, relationships and every reader stay authoritative (§8.1, §8.2).
Nothing here changes a ledger row, relationship, transaction or existing
purchase, and nothing fires a hook.

**Attribution.** `Services\PaymentAttribution` decides a transaction's links
from the evidence of §6.1 only, so the shadow writer and the backfill reach
the same conclusion. It returns every link of the transaction, or none and
the §6.2 reason; `amount_mismatch` is a note on an attributed transaction.
Lookups go through `PaymentAttributionSources`
(`PaymentAttributionDatabase` on a site). The rules per source:

| Source                         | Purchase                                                                                                                                                             | Role and allocation                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fair-events-get-tickets`      | `signup_ids`, else `signup_id`, else the single purchase whose `transaction_id` is the transaction. A named purchase that doesn't exist: `no_evidence`.              | `charge`. One purchase: the total. Several: each its own `amount`, only when they add up (`allocation_mismatch`).                                |
| `fair-audience-signup`         | `event_participant_ids`, else `event_participant_id`, else the ledger; each confirmed by its ledger row, then the purchase naming the relationship as provenance.    | `charge`. Several: one identical line item each, else `allocation_mismatch`. A retry of a multi-occurrence purchase (G7): `allocation_mismatch`. |
| `fair-audience-activity-addon` | The purchase owning `ticket_id`; else the relationship's purchase; else the participant's single active purchase on the date. Otherwise `ambiguous_activity_charge`. | `additional_charge`, the total.                                                                                                                  |
| `fair-audience-series-upgrade` | The relationship's purchase, else the participant's single active purchase on the master date. Otherwise `ambiguous_upgrade`.                                        | `upgrade`, the total.                                                                                                                            |
| Anything else with ledger rows | Only one ledger row, whose relationship has a purchase. Otherwise `no_evidence`.                                                                                     | `charge`, the total.                                                                                                                             |

A transaction with `fee_payment_id`, or with no event source and no ledger
row, is out of scope. Ledger rows of different participants on one
transaction are `participant_relationship_conflict`. Refund-labelled ledger
rows are left to the backfill (§11).

**Shadow purchases.** `Services\ShadowPurchases` keeps one purchase in step
with a relationship that admits someone without an Events purchase: one
newer than the coverage floor that is `signed_up` and meets §4.1, or
`pending_payment` within its hold when its latest ledger charge comes from
Audience's purchase route (so a pending relationship that belongs to an
Events checkout never gets one). The purchase:

- names the relationship in `legacy_event_participant_id`, so both legacy
  filters skip it (§8.7) and the purchase's single unit counts instead;
- copies the participant's name and email, `ticket_type_id`, and the
  relationship's `created_at` converted to site time;
- follows the relationship: `signed_up` → `confirmed`; `pending_payment`
  within its hold → `pending_payment` with the same `payment_expires_at`;
  an expired hold or a deleted pending relationship → `expired`;
  `interested`, `collaborator` or a deleted confirmed relationship →
  `cancelled`. Its event date and ticket type follow moves and series
  upgrades, and its unit follows all of these;
- has the relationship's participant-scope activities and check-in copied
  onto its unit (§4.4). Activities are updated, never removed: a released
  hold lapses at its own `expires_at`;
- has `amount` = what its paid links allocate to it, or while nothing is
  paid, its latest charge attempt's allocation (§4.2);
- never has a `transaction_id`, so no Events payment handler, retry or
  confirmation email acts on it.

Because the unit carries those activities, Fair Audience's
`count_participant_scope_selections()` and Statistics'
participant-scope selections now also skip relationships named by
provenance. Audience reports this with
`EventParticipantRepository::excludes_provenance_activity_selections()`.

**Writers and the queue.** `Services\PaymentHistoryShadowWrites`:

- queues every transaction on `fair_payment_transaction_created`, with the
  relationships its metadata names;
- re-queues a transaction after the coverage floor, and the relationships
  its metadata and ledger name, on `fair_payment_status_changed`;
- does the queued work at `shutdown`, after every writer of the request:
  relationships first, then transactions, writing links with
  `attribution = live` through `PaymentLinks::write()`;
- sweeps every fifteen minutes (cron `fair_events_payment_history_shadow_work`)
  and after Audience's expiry cron for relationships out of step: new
  `signed_up` admissions without a purchase (organizers adding
  participants), purchases whose relationship changed or was deleted, and
  participant-scope activities missing from the unit.

Work lives in `fair_events_payment_shadow_work`, unique per (kind, source),
and is removed once it succeeds. A failed attempt (`failed`, with the error
code) or one whose evidence names no purchase yet (`unresolved`, with the
§6.2 reason) stays, and is retried after 2 minutes, doubling to at most a
day. Work queued inside a database transaction that its writer rolled back
is dropped with it. Outstanding work is a verification blocker
(`PaymentShadowWork::count_outstanding()`).

**Coverage.** `PaymentHistoryCompatibility::shadow_writes_supported()` needs
storage, DB `3.50.0` and a compatible Audience (both markers, or none
active). `PaymentHistoryShadowWrites::maybe_enable()` then records, once,
`shadow_writes` in `fair_events_payment_history_migration`: `enabled_at`
(UTC) and the highest transaction and relationship IDs at that moment. Up
to those floors history is the backfill's; after them it is the live
writers'. `shadow_write_coverage()` is true from then on, which clears the
`shadow_writes_incomplete` backfill blocker.

| Combination                               | Behaviour                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Events + Audience + Connector, both newer | Shadow writes on.                                                                                                                     |
| Newer Events + Audience older than this   | Shadow writes stay off (`audience_incompatible`): an older Audience would count copied activities twice.                              |
| Older Events + newer Audience             | Audience finds no provenance support and keeps its previous queries.                                                                  |
| Events without Audience                   | Shadow writes on for get-tickets; no relationship to mirror.                                                                          |
| Events + Audience without Connector       | Links can't be written (`payment_information_unavailable`); the work waits in the queue, and shadow purchases are still kept in step. |

### 8.9 Stage 3 backfill and verification

**Implemented** (#2139, second of three pull requests; Fair Events DB
`3.51.0`). `Services\PaymentHistoryBackfill` migrates history up to the
cutoffs, reports what it can't attribute, and verifies the result. It
changes no ledger row, relationship, participant-scope activity,
transaction, or `live` or `reconciled` link, and fires no hook. Ownership
and the Statistics readers don't change (§8.1).

**Starting.** An administrator runs a dry run, reviews it, confirms a
database backup and starts the backfill (`start_dry_run()`,
`start( array( 'backup_confirmed' => true ) )`). Both refuse while
`backfill_blockers()` lists anything, which now includes
`storage_unavailable` below DB `3.51.0`; the backfill also refuses without a
completed dry run over the same cutoffs (`dry_run_required`,
`dry_run_stale`) or a confirmed backup (`backup_required`). Nothing starts on
plugin upgrade. The Payment history page and its REST routes (§8.10) start
and follow it.

**Cutoffs.** The cutoffs are the shadow writes' coverage floors (§8.8), not
the highest IDs when the backfill starts (§8.2): records after the floors
are already the live writers', and leaving them to them means the backfill
never races a live writer over the same new record.

**Runs.** State lives in `fair_events_payment_history_migration`: `dry_run`
and `backfill`, each with its status, cutoffs, phase, cursor, counts and
last error, and the top-level `status`, which mirrors the backfill's
(`verified` makes `migration_verified()` true). Batches are serialized by a
named lock and run through the cron `fair_events_payment_history_backfill_batch`;
a failed batch keeps its cursor at the last record that succeeded and is
retried with a growing delay. A blocker that appears mid-run pauses the
backfill; the shadow work cron continues it once the blocker clears and
reschedules a run whose cron event was lost. The phases, in ID order:

1. **Admissions.** Each relationship is classified by
   `PaymentHistoryAdmissions` (§4.1, §4.3). A legacy admission gets its
   purchase through `ShadowPurchases::create_purchase()`, the shape shadow
   purchases have (§4.2), with its participant-scope activities copied
   onto its unit with their status and hold, its check-in unless
   `TicketHistoryBackfill` already placed it, and the links of the attempts
   its ledger names that are attributable now. All of it commits in one
   database transaction, under the relationship's lock and then each
   transaction's link lock in ascending order. `pending_payment`
   relationships are skipped and revisited. A generated occurrence's
   relationship covered by a whole-series pass on its master (a signed-up
   relationship or confirmed purchase of a whole-series type, bought before
   the occurrence's pass cutoff) is `duplicate_series_relationship`.
2. **Activities.** A relationship whose purchase names it as provenance has
   its activities copied onto that purchase's unit. Otherwise its
   activities stay at participant scope, because copying them without
   marking the read-only source row would count them twice in capacity:
   with exactly one ticket held there Statistics already assigns them to
   it; with zero or several they are `ambiguous_activity`.
3. **Transactions.** Every Connector transaction is attributed by
   `PaymentAttribution` and linked with `attribution = backfill`, or
   reported with its reason. `amount_mismatch` isn't reported for a
   backfilled or shadow purchase, whose amount comes from its links. Stored
   links that refuse the set (a different `live` or `reconciled` link, or
   no room under the total) are reported as `existing_link_conflict`, an
   addition to §6.2; nothing is changed.
4. **References.** A refund-labelled ledger row is reported as
   `unsupported_refund_record` and, when its relationship maps to one
   purchase, kept as a `legacy_refund_record` link with
   `allocated_amount = 0`, so it never uses up the transaction's total. A
   ledger row or purchase naming a deleted transaction is
   `missing_transaction`.
5. **Revisit** (backfill only). Signed-up relationships without a purchase
   are classified again, which admits checkouts that completed during the
   run, and open findings about attribution or activities are attributed
   again; a finding that resolves is marked `resolved`.
6. **Verify** (backfill only). `PaymentHistoryVerification` compares every
   event date and stores the result in
   `fair_events_payment_history_comparisons`, then runs the global checks.

**Dry run.** The same phases up to references, through the same rules:
`PaymentHistoryPlannedSources` lets `PaymentAttribution` see a planned
purchase (the negative relationship ID) for every relationship the backfill
would admit, so both reach the same conclusions. It writes no purchase,
unit, activity or link, only its own findings, and counts what it would
create, plus the paid totals per currency it would attribute and leave
unresolved. A new dry run replaces the previous dry run's findings.

**Findings** live in `fair_events_payment_history_findings`, one per
(mode, reason, source type, source ID): `transaction`, `relationship`,
`ledger_row`, `signup` or `link`, with the event date from immutable
metadata when there is one. A re-run refreshes a finding instead of adding
one. `amount_mismatch`, `multiple_paid_attempts` and
`unsupported_refund_record` are informational. `multiple_paid_attempts`
covers the `charge` and `upgrade` roles: several paid add-ons are separate
purchases of activities, not attempts.

**Verification report** (§8.4), per stored event date, so a whole-series
pass counts once on its master on both sides:

- **Admissions.** The source side counts confirmed units of ordinary
  purchases, confirmed purchases without units, and signed-up
  relationships by today's rule with provenance ignored. The target side is
  what Statistics counts now. The only allowed difference, `legacy_rule`,
  is a provenance purchase whose participant only had a failed or expired
  ordinary purchase there, which §4.1 admits and gap G3 hid.
- **Activity selections**, split the same way. Reported, never blocking.
- **Revenue** per currency and transaction: the ledger's paid transactions
  on signed-up relationships against paid link allocations. Allowed causes:
  `shared_transaction` (fully allocated across several purchases, §5.4),
  `legacy_refund_record` (§11), `unresolved` (an open finding lists it), and
  `not_in_ledger`: a paid link today's ledger reader can't reach, such as a
  purchase whose relationship isn't signed up or that Audience never
  recorded. That last cause is an addition to §8.4: such money was received,
  and stage 5 counts it. Anything else is `unexpected` and blocks.
- `revenue_state` is `incomplete` when the date has unresolved money or an
  unallocated remainder (§7.1), else `available`. For a generated
  occurrence, `series_pass_revenue` is what today's Statistics adds there
  for passes: the difference §7.2 introduces at stage 5.

The global checks block on: a blocking date (`unexpected_differences`),
outstanding shadow work (`shadow_work_outstanding`), a transaction
allocated beyond its total (`allocation_exceeds_total`), and a paid event
payment (a recognised source or a ledger row, not a participant fee) with
no link and no open finding (`unlisted_paid_transactions`). They also
record `multiple_paid_attempts`, `currency_mismatch` and links naming
deleted transactions. The backfill ends `verified` or
`verification_failed`; `verify()` runs the report again.

### 8.10 Stage 3 reconciliation

**Implemented** (#2139, third of three pull requests; Fair Events DB
`3.52.0`). Administrators decide on what the backfill reported, as §6.3
requires. Ownership and the Statistics readers still don't change (§8.1).

**Interfaces.** `API\PaymentHistoryController` registers, under
`fair-events/v1/payment-history`, every route behind `manage_options` (401
logged out, 403 without it):

| Route                                  | Use                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /`                                | `PaymentHistoryBackfill::status()`, plus `reconciliation_available` and finding counts per status.      |
| `POST /dry-run`, `/backfill`           | Start a dry run, or the backfill with `backup_confirmed`. Refusals are 409 (400 for `backup_required`). |
| `POST /backfill/resume`, `/verify`     | Continue a paused backfill; verify a finished one again.                                               |
| `GET /comparisons`                     | The verification report, blocking dates first, then incomplete revenue.                                |
| `GET /findings`                        | Findings by `mode`, `status` (`open`, `decided`, `resolved`, `all`), `reason`, `event_date_id`, source, `transaction_status` and `payment_mode`. |
| `GET /findings/{id}`                   | The finding with its transaction, links, remaining balance, suggested purchases and audit trail.       |
| `POST /findings/{id}/links`            | Link the finding's transaction: `links` (`signup_id`, `role`, `allocated_amount`), `note`, `expected_link_ids`. |
| `POST /findings/{id}/review`           | Mark the finding reviewed with a `note`.                                                               |
| `DELETE /links/{id}`                   | Remove a reconciled link: `note`, `expected_link_ids`.                                                 |
| `GET /purchases`, `GET /audit`         | Purchase search by number, name or email; audit records, newest first.                                 |

`Services\PaymentHistoryReconciliation` holds the rules:

- Only backfill findings are reconciled; a dry run's are replaced by the
  next dry run (`finding_not_reconcilable`). Linking applies to transaction
  findings whose evidence named no purchase, several, or didn't add up:
  `no_evidence`, `allocation_mismatch`, `ambiguous_activity_charge`,
  `ambiguous_upgrade`, `participant_relationship_conflict`,
  `existing_link_conflict`. Any open finding can be marked reviewed,
  informational ones included.
- Links are written with `attribution = reconciled` through
  `PaymentLinks::write_in_transaction()`, so §5.1 holds: the total is never
  exceeded, and a set conflicting with stored links is refused. Roles are
  `charge`, `additional_charge` and `upgrade`. Identifying hints from the
  transaction (metadata, editable columns, the registrations it names) only
  suggest purchases (§6.1); the administrator chooses.
- Each action runs under the transaction's link lock, in one database
  transaction with the finding change and an audit record. It is refused as
  `reconciliation_stale` (409) when the finding is no longer open or the
  transaction's link IDs differ from `expected_link_ids`, so a concurrent
  decision is never overwritten. A note is required.
- Linking marks every open linkable finding of the transaction
  `reconciled`; reviewing marks the finding `reviewed`. Removing the last
  reconciled link of a transaction opens its reconciled findings again.
  `SignupPaymentLink::delete_reconciled()` is the only deletion of a link,
  and refuses `live` and `backfill` ones.
- Afterwards the affected purchases' amounts follow their links (§4.2), the
  affected event dates are compared again, and a finished backfill is
  verified again.

**Re-runs.** `PaymentHistoryFinding::record()` never reopens a `reconciled`
or `reviewed` finding, and the backfill skips a transaction with a
reconciled link or a decided finding (`transaction_reconciled`), so a
re-run neither changes nor re-reports an administrator's decision. A
reviewed transaction stays unlinked even if later evidence would attribute
it: a review can't be undone yet. Undoing one is left for a follow-up.

**Verification** treats a decided transaction as explained: its revenue
difference has the cause `reconciled`, an addition to §8.4's causes, and a
paid transaction with a decided finding isn't `unlisted_paid_transactions`.
A reviewed finding doesn't make revenue `incomplete` (§7.1): the
administrator decided the money belongs to no purchase.

**Transaction filters** (#2219). `transaction_status` (a list of Connector
statuses, any of which matches: `draft`, `pending_payment`, `open`,
`pending`, `authorized`, `paid`, `failed`, `canceled`, `expired`,
`refunded`, `charged_back`) and `payment_mode` (`all`, `test`, `live`) read
the finding's transaction as it is now in Connector (`status`, `testmode`),
not a snapshot from the run, and are independent of the run's `mode`. The
transaction is the one reconciliation uses: the source of a transaction
finding, otherwise `detail.transaction_id`. No status and `all` mode, the
defaults, list every finding; an active filter matches only findings whose
transaction exists and satisfies it, and matches nothing while Connector's
transactions can't be read. Totals and pages follow every filter; the
reason and event counts still follow only run and status.

**Audit.** `fair_events_payment_history_audit` (`Models\PaymentHistoryAudit`)
is append-only: `action` (`link`, `unlink`, `review`), `finding_id`,
`reason`, `transaction_id`, `user_id`, `note`, `before_state` and
`after_state` (the finding status and the transaction's links, JSON) and
`created_at` (UTC).

**Page.** Fair Events → Payment history (`src/Admin/payment-history/`,
listed once payment link storage exists, `manage_options`) shows the
migration's progress and blockers with its controls, the verification
report, and the findings filtered by run, status, reason, event, payment
status and payment mode. A
finding's dialog names the payment, its amount and status, the purchases
already linked and the balance left, and collects the allocation and the
note. Starting the migration is confirmed with the backup tables named.

### 8.11 Stage 4 lifecycle: get-tickets

**Implemented** (#2140, first of three pull requests; no schema change).
`Services\PurchaseLifecycle` makes the get-tickets flows write and read
payment links as the authority. It runs only once the cutover is active,
which nothing can switch on until the third pull request adds the
activation; until then every flow behaves as in §8.8. The second pull request
moves Fair Audience's routes (its purchase route, add-ons and series
upgrades) onto the same service; until it lands they keep their previous
behaviour, and the activation must refuse to run without it.

**The gate.** `PaymentHistoryCompatibility::ownership_cutover()` is true
when the state option's `cutover` entry has an `activated_at` and the links
storage and work queue exist (DB `3.50.0`). The entry is separate from the
backfill's `status`: a later `verification_failed` doesn't clear it, so
authority never moves back to the ledger (§8.5).

**Writes.**

- A checkout's attempt is linked (`attribution = live`, through
  `PaymentAttribution` as in §8.8) right after the transaction exists and
  before the signup hooks run or the payment starts, so Fair Audience
  projects only what Events has recorded. When the links can't be written
  the buyer gets a 503 (`payment_not_recorded`) and nothing is charged; the
  same idempotency key continues the checkout with the same transaction.
- A retry links its new attempt before the purchases move to it, so a
  purchase never points at an attempt missing from its history.
- `fair_events_signups.transaction_id` keeps meaning "latest attempt"
  (§5.1). Retry and "Cancel and start over" resolve the purchases whose
  latest attempt is the transaction from its links
  (`current_signup_ids()`); an attempt without links (one the backfill left
  unresolved) falls back to its metadata.
- Free purchases, holds and their expiry are unchanged: they have no
  attempt to link.

**Notifications** (`Hooks\PaymentHooks` delegates to the service).

- **Paid:** the purchases are the attempt's `charge` links, whichever
  attempt is each purchase's latest, so a late payment for a superseded
  attempt confirms its purchase (§5.5). A purchase that is already
  confirmed is left alone, so a replayed or concurrent notification
  confirms and announces once. The capacity recheck and over-capacity flags
  of a lapsed hold are unchanged. When an attempt has no links yet they are
  written first; when that fails the notification is queued (work kind
  `payment`) and applied again by the retry cron. More than one paid
  attempt for a purchase records the backfill's `multiple_paid_attempts`
  finding; every paid attempt counts.
- **Failed, cancelled, expired:** only purchases whose latest attempt it is,
  and only while they await payment. A delayed failure never undoes a
  confirmation or touches a newer attempt.
- **Announcing:** `fair_events_signup_confirmed` fires after the
  confirmation committed. The request that confirmed the purchase queues a
  `confirmation` work row first and removes it after the hook ran; when the
  request dies in between, the retry cron announces it five minutes later.
  Delivery is at least once: a request that dies after the hook but before
  removing the row is announced twice.

**Queue.** The lifecycle's rows share `fair_events_payment_shadow_work`
(kinds `payment` and `confirmation`), its retry delays and its
verification blocker. After the cutover the cron keeps running them even
if shadow writes lose coverage (an older Fair Audience installed later),
and still skips the shadow work then.

**Not yet covered.** The callback page and payment-state route still read
the purchases by their latest attempt (`get_all_by_transaction_id()`); a
buyer returning from a superseded attempt that was paid sees the newer
attempt's state. Readers move in stage 5 (#2141).

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
  an older Audience. Implemented as
  `fair-events/__tests__/Services/PaymentLinkAllocationTest.php`,
  `PaymentLinksTest.php` (writer, reader, capabilities, older and newer
  Audience), `fair-audience/__tests__/Database/AdmissionsProvenanceTest.php`
  (older and newer Events) and
  `fair-events/src/API/__tests__/PaymentHistoryFoundation.api.spec.js`
  (schema on install and upgrade, provenance in capacity and Statistics
  including a series pass, uniqueness, conflicts, concurrent writers).
- **Stage 3 (#2139), shadow writes:** `fair-events/__tests__/Services/PaymentAttributionTest.php`
  (the rules of §8.8 for examples 2, 3, 7, 8, 10–12, 14, 20, 21 and G7),
  `PaymentLinksTest.php` (coverage and compatibility),
  `fair-audience/__tests__/Database/AdmissionsProvenanceTest.php` (the
  activity filter) and
  `fair-events/src/API/__tests__/PaymentHistoryShadowWrites.api.spec.js`
  (live links for a get-tickets attempt and its retry; an Audience
  purchase's shadow purchase through pending, paid and capacity; an
  organizer-added participant through the sweep; queued work).
- **Stage 3 (#2139), backfill:** `fair-events/__tests__/Services/PaymentHistoryPlannedSourcesTest.php`
  (the dry run reaches the backfill's conclusions for examples 3, 11, 20
  and 21), `PaymentHistoryVerificationTest.php` (the allowed and unexpected
  differences) and
  `fair-events/src/API/__tests__/PaymentHistoryBackfill.api.spec.js`
  (examples 3, 4, 5, 7, 9, 11, 13, 14, 16 and 20–22 through a dry run and
  the backfill, a repeated interrupted batch, a checkout completed during
  the run, a re-run, and the verification report).
- **Stage 3 (#2139), reconciliation:** `PaymentHistoryVerificationTest.php`
  (the `reconciled` cause),
  `fair-events/src/API/__tests__/PaymentHistoryReconciliation.api.spec.js`
  (401/403 on every route, validation, stale and concurrent decisions,
  linking and splitting examples 11 and 21, reviewing examples 9 and 14, the
  audit, removal, and a re-run keeping every decision), the component tests
  in `src/Admin/payment-history/__tests__/` and
  `fair-events/e2e/payment-history-reconciliation.spec.js`.
- **Stage 3 (#2139):** API specs with fixtures for examples 3, 4, 5, 7, 9, 11,
  13, 14, 16 and 20–22. Rerun and resume specs (examples 17, 18). The
  verification report, including the reasons in §6.2. Reconciliation
  permissions: 401 when anonymous, 403 for a non-administrator, and an audit
  record for each action.
- **Stage 4 (#2140):** specs for free, paid, failed, retried (8, 9),
  cancelled, add-on (10) and upgrade (12) flows, each writing links first.
  Webhook replay produces no duplicates. A late paid notification for an
  older attempt confirms the purchase. Get-tickets (first pull request):
  `PaymentLinksTest.php` (the gate) and
  `fair-events/src/API/__tests__/PaymentLifecycleCutover.api.spec.js`
  (links before payment, a late paid superseded attempt with example 9's
  finding, replayed, concurrent and delayed notifications, cancelling from
  links, and an interrupted confirmation finished by the cron).
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
