=== Fair Payments Connector Experimental ===
Contributors: marcinwosinek
Tags: payments, mollie, telegram
Requires at least: 6.7
Tested up to: 7.0
Requires PHP: 8.0
Stable tag: 0.2.0
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

## 0.2.0

### Minor Changes

-   6ab4e73: Initial release: moves API Tokens, Connected Sites, and Telegram notification dispatch out of fair-payments-connector into a new experimental plugin

### Added

-   Initial release: API Tokens, Connected Sites, and Telegram Notifications moved from fair-payments-connector
