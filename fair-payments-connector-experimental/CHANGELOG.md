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
