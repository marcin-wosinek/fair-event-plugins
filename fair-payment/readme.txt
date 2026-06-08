=== Fair Payment ===
Contributors: marcinwosinek
Tags: payment, mollie, events, bookkeeping, block
Requires at least: 6.2
Tested up to: 7.0
Stable tag: 1.3.2
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Mollie-based payments and bookkeeping for WordPress events.

== Description ==

Fair Payment is the money layer of the Fair Event plugin suite. It handles Mollie payment processing, stores transactions with line items, and provides a ledger for budgets and bank-import reconciliation.

Features:

* Mollie payment gateway with test/live modes, application fees, and webhook handling
* Transactions with itemized line items, linked to posts, event dates (fair-events), and participants (fair-audience)
* Status lifecycle (`draft` → `pending_payment` → `paid`/`failed`) with action hooks (`fair_payment_paid`, etc.)
* Proactive status sync to recover stuck pending payments
* Budgets and financial entries ledger with split entries, event linkage, and import deduplication
* Many-to-many reconciliation between bank-import entries and transactions
* Token-authenticated data sharing API so satellite sites can pull their own transaction data from a hub site
* Telegram notifications on payment events
* Gutenberg "Simple Payment" block (amount, currency, description) for standalone use
* Admin pages for transactions, budgets, entries, reconciliation, API tokens, connected sites, and settings

Public PHP API for integration from other plugins:

* `fair_payment_create_transaction( $line_items, $args )`
* `fair_payment_initiate_payment( $transaction_id, $args )`
* `fair_payment_get_transaction( $transaction_id )`
* `fair_payment_sync_transaction_status( $transaction_id )`

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-payment` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress

== Development ==

* GitHub Repository: https://github.com/marcin-wosinek/fair-event-plugins
* Report Issues: https://github.com/marcin-wosinek/fair-event-plugins/issues
* Contribute: https://github.com/marcin-wosinek/fair-event-plugins/pulls

== Changelog ==

= 0.1.0 =
* Initial release
