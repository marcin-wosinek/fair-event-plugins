# fair-payments-connector

## 1.3.3

### Patch Changes

-   9dadc92: Document external services (Mollie API, Fair Event Plugins OAuth proxy, Telegram Bot API) in readme.txt per WordPress.org plugin review requirements.
-   59a6d62: Gate `/payments/{id}/status` with a per-transaction access token so transaction IDs cannot be enumerated. The token is generated at creation time, propagated through the Mollie redirect URL, and required for anonymous reads. Logged-in admins and the transaction's owner can still read without a token.
-   0ebaea4: Group admin menus with string positions to avoid overwriting core menus

    Each plugin's top-level admin menu now registers with a unique string decimal
    position (`20.1`–`20.4`) so the four menus cluster together in order without
    colliding with each other or with core WordPress menu items.

## 1.3.2

### Patch Changes

-   c309dcf: Add `defined( 'ABSPATH' ) || exit;` guard to the simple-payment block's `render.php` so Plugin Check's `missing_direct_file_access_protection` error is cleared.
-   eb53475: Bump minimum WordPress version to 6.2 so the `%i` identifier placeholder used in `$wpdb->prepare()` is supported on the declared floor, clearing Plugin Check `UnsupportedIdentifierPlaceholder` errors before publishing.

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
