=== Fair Payments Connector ===
Contributors: marcinwosinek
Tags: payments, mollie, events, tickets, bookkeeping
Requires at least: 6.7
Tested up to: 7.0
Stable tag: 1.6.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Accept Mollie payments and keep the books in WordPress — payment block, itemized transactions, budgets, and bank reconciliation.

== Description ==

Fair Payments Connector is the money layer for your WordPress site: it takes payments through Mollie and keeps the records that follow. Drop the Simple Payment block on any page to charge a one-off amount, or pair it with Fair Events to sell tickets — either way, every payment lands as a clean, itemized transaction you can trace from checkout to your bank statement.

**Fair pricing, no subscription:** Install for free — every feature is included, with no premium tier. Instead of charging upfront, a 1% integration fee on ticket sales is collected automatically in the payment flow, capped at €12/month for the whole plugin suite: sell nothing in a month, pay €0; sell for €200, pay €2. If your sales never reach €1,200 in a month, you pay less than the €12 sticker price. See [fair-event-plugins.com](https://fair-event-plugins.com/) for details.

**Key Features:**

* **Mollie Checkout in Minutes:** Connect your Mollie account with a guided flow (or paste an API key) and switch between test and live modes
* **Your Payment Methods:** Whatever you enable in your Mollie account — iDEAL, credit cards, Bancontact, PayPal, bank transfer, and more
* **Simple Payment Block:** Take a payment from any page; set amount, currency, and description right in the editor
* **Ticket Checkout for Fair Events:** Powers the paid signup flow of [Fair Events](https://wordpress.org/plugins/fair-events/) automatically when both plugins are active
* **Reliable Status Tracking:** Webhooks plus proactive status sync, so a payment stuck in "pending" recovers on its own
* **Bookkeeping Included:** Budgets and a financial-entries ledger; import bank statements and reconcile them against your transactions
* **Instant Notifications:** Optional Telegram message the moment a payment succeeds or fails
* **Multi-Site Ready:** Satellite sites can pull their own transaction data from a central hub over a token-secured API
* **Fair Pricing Model:** No premium tiers or hidden features - everything is included

**Perfect For:**

* Event organizers selling tickets with Fair Events
* Community groups and nonprofits collecting fees or donations
* Associations that want payments and simple bookkeeping in one place
* Anyone who needs a payment button on a WordPress page without setting up a webshop

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-payments-connector` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Open the plugin's Settings page and connect your Mollie account (guided flow or API key). Start in test mode to try it out.
4. Add the Simple Payment block to a page, or configure ticket prices in Fair Events.

== Development ==

* GitHub Repository: [marcin-wosinek/fair-event-plugins](https://github.com/marcin-wosinek/fair-event-plugins)
* Report Issues: [Issues](https://github.com/marcin-wosinek/fair-event-plugins/issues)
* Contribute: [Pull Requests](https://github.com/marcin-wosinek/fair-event-plugins/pulls)

== Frequently Asked Questions ==

= Do I need the other Fair Event plugins? =

No. The Simple Payment block works on its own. When Fair Events is active, the plugin automatically handles its paid ticket checkout as well.

= What does the plugin cost? =

There is no subscription and no premium tier. A 1% integration fee on ticket sales is collected automatically through the payment flow, capped at €12 per month for the whole plugin suite — in a month without sales you pay nothing. Mollie's own transaction fees apply separately. See [fair-event-plugins.com](https://fair-event-plugins.com/) for details.

= Do I need a Mollie account? =

Yes — Mollie processes the payments. Creating an account at mollie.com is free, and you can run the plugin in test mode before going live.

= Which payment methods are supported? =

Every method enabled in your Mollie account, such as iDEAL, credit and debit cards, Bancontact, PayPal, and bank transfer.

= Can other plugins integrate with it? =

Yes. A small public PHP API creates and tracks transactions, and action hooks such as `fair_payment_paid` fire on status changes. See the Developer Notes below.

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

The full changelog is maintained on GitHub:
[CHANGELOG.md](https://github.com/marcin-wosinek/fair-event-plugins/blob/main/fair-payments-connector/CHANGELOG.md)

== Developer Notes ==

Public PHP API for integration from other plugins:

* `fair_payment_create_transaction( $line_items, $args )`
* `fair_payment_initiate_payment( $transaction_id, $args )`
* `fair_payment_get_transaction( $transaction_id )`
* `fair_payment_sync_transaction_status( $transaction_id )`

Transactions move through a status lifecycle (`draft` → `pending_payment` → `paid`/`failed`) with action hooks such as `fair_payment_paid` fired on each change.

The plugin is open source and contributions are welcome on [GitHub](https://github.com/marcin-wosinek/fair-event-plugins).
