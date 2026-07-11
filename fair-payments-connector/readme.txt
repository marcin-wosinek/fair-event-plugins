=== Fair Payments Connector ===
Contributors: marcinwosinek
Tags: payment, mollie, events, bookkeeping, block
Requires at least: 6.2
Tested up to: 7.0
Stable tag: 1.5.1
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Mollie-based payments and bookkeeping for WordPress events.

== Description ==

Fair Payments Connector is the money layer of the Fair Event plugin suite. It handles Mollie payment processing, stores transactions with line items, and provides a ledger for budgets and bank-import reconciliation.

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

1. Upload the plugin files to the `/wp-content/plugins/fair-payments-connector` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress

== Development ==

* GitHub Repository: https://github.com/marcin-wosinek/fair-event-plugins
* Report Issues: https://github.com/marcin-wosinek/fair-event-plugins/issues
* Contribute: https://github.com/marcin-wosinek/fair-event-plugins/pulls

== External services ==

This plugin relies on the following third-party services. Data is only sent to a service when you enable and configure the related feature.

= Mollie payment gateway (api.mollie.com) =

Used to process payments. When a customer initiates a payment through the plugin (for example by submitting the Simple Payment block, or when another plugin calls `fair_payment_initiate_payment()`), the plugin contacts the Mollie API to create the payment and later to retrieve its status (including via Mollie webhooks and periodic status sync). Data sent includes: payment amount and currency, description, redirect/webhook URLs of your site, customer billing email when provided, and your Mollie access token. Mollie is operated by Mollie B.V.

* Terms of service: https://www.mollie.com/legal/user-agreement
* Privacy policy: https://www.mollie.com/legal/privacy

= Fair Event Plugins OAuth proxy (fair-event-plugins.com) =

Used only if you connect Mollie through the built-in OAuth flow instead of pasting a personal API key. The plugin redirects you to `https://fair-event-plugins.com/oauth/authorize` to authorize access to your Mollie account, and later calls `https://fair-event-plugins.com/oauth/refresh` to refresh the Mollie access token when it expires. Data sent includes: the OAuth refresh token stored in your site and, during initial authorization, the parameters Mollie returns to the proxy. The proxy is operated by the plugin author (Marcin Wosinek) and exists because Mollie OAuth requires a registered client secret that cannot ship in a public plugin.

* Terms of service: https://fair-event-plugins.com/terms/
* Privacy policy: https://fair-event-plugins.com/privacy/

= Telegram Bot API (api.telegram.org) =

Used only if you configure a Telegram bot token and chat ID in the plugin settings to receive payment notifications. When a payment event occurs (such as a payment being marked as paid or failed), the plugin sends an HTTP request to `https://api.telegram.org/bot<token>/sendMessage` containing the notification text (transaction id, amount, status, and a link back to the admin transaction page) and the configured chat id. The Telegram Bot API is operated by Telegram FZ-LLC / Telegram Messenger Inc.

* Terms of service (Bot API): https://telegram.org/tos/bot-developers
* Privacy policy: https://telegram.org/privacy

= Other WordPress sites you connect (hub / satellite data sharing) =

If you use the connected-sites / data-sharing feature, the plugin will send authenticated REST requests to the WordPress site URLs you explicitly enter in the "Connected sites" admin page so it can pull transaction data. No data is sent to those sites unless you configure them yourself. There are no third-party terms for this feature — the remote endpoint is another WordPress site running this same plugin, under your control.

== Changelog ==

= 0.1.0 =
* Initial release
