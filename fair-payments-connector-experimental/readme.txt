=== Fair Payments Connector Experimental ===
Contributors: marcinwosinek
Tags: payments, mollie, telegram
Requires at least: 6.7
Tested up to: 7.0
Requires PHP: 8.0
Stable tag: 0.3.0
License: Private
License URI: https://fair-event-plugins.com

Experimental features for Fair Payments Connector: API tokens, connected sites, and Telegram notifications.

== Description ==

This plugin houses features that are under active development and not yet ready for general availability. Requires Fair Payments Connector to be active.

**Features:**

* API Tokens — issue scoped bearer tokens so other sites can read transaction data
* Connected Sites — pull transaction data from other sites over the data sharing API
* Telegram Notifications — send payment notifications to Telegram chats

== Changelog ==

## 0.1.0

## 0.3.0

### Minor Changes

-   c60efeb: Replace the Telegram-only single-route notification system with a flexible multi-channel setup. Operators configure independent routes, each with a channel (email or Telegram), destination, frequency (immediate / hourly / daily / weekly), and PII inclusion toggle.

    Key additions: `NotificationChannel` interface with `TelegramChannel` and `EmailChannel` implementations; a `fair_payment_notification_queue` table with `DigestHooks` cron flush; a `DigestBuilder` that prepends count and per-currency totals to batched bodies; a new `POST /fair-payments-connector/v1/notifications/test` REST endpoint; and a React route-list admin UI. Existing Telegram config is migrated automatically to an immediate route.

## 0.2.0

### Minor Changes

-   6ab4e73: Initial release: moves API Tokens, Connected Sites, and Telegram notification dispatch out of fair-payments-connector into a new experimental plugin

### Added

-   Initial release: API Tokens, Connected Sites, and Telegram Notifications moved from fair-payments-connector
