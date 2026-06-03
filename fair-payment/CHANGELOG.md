# fair-payment

## 1.3.1

## 1.3.0

### Minor Changes

-   7f6ab85: Add Connected Sites for cross-site transaction data sharing: a data-sharing API exposing transactions to authorised sites, a consumer side that pulls from connected sites, and a Mollie settlement CSV import. Transaction import now lets you choose a connected-site or file source.
-   7682a28: Add a setting to disable bank-transfer payment close to the event date.
-   7f6ab85: Overhaul reconciliation splitting and allocations: auto-split a matched entry into one child per transaction, allow negative and adjustment allocations, store allocation amounts with their original sign, allow nonzero amounts when editing a split, tick the transaction on automatic matching, and add a bulk "Load Missing Mollie Fees" action to the transactions list.
-   7f6ab85: Send Telegram notifications for successful transactions, with test-mode payments clearly marked.
-   7f6ab85: Enrich transaction export: include the event URL as `detail_url`, carry the source `event_date_id`, and rename the entry "event" label to "link" so it is inherited on match.

### Patch Changes

-   7f6ab85: Miscellaneous fixes: link to the event page from the admin calendar, close the payment callback popup without a page reload, integrate the confirm & save buttons in the edit popup, keep a cancelled signup registered as "interested", remove the email from the purchase message, and stop nulling transactions.
-   7f6ab85: Update the local Docker environment and "Tested up to" headers to WordPress 7.

## 1.2.0

### Minor Changes

-   d04f565: Transaction reconciliation improvements. Import Mollie transaction reports, display links from transactions to budget entries, link payments to participants via typeahead with an option to update missing participants, and limit reconciliation to live (production) mode.
-   41a295c: Add payment error logging. New `PaymentLog` model with database schema, REST endpoint, and admin log viewer on the transaction page. Mollie webhook and payment endpoints record errors for troubleshooting.

## 1.1.1

### Patch Changes

-   c8a6a54: Improve the mobile UI for transactions.

## 1.1.0

## 0.2.0

### Minor Changes

-   3abfc47: Add application fee to transactions.
-   457cd90: Show transation result when open call payment callback.
-   e61b58c: Add advanced settings view, to simplify troubleshooting

### Patch Changes

-   a25d6c7: Move Mollie payment integration to OAuth & Mollie Connect.
