## 0.3.2

### Patch Changes

-   af12d06: Make Telegram/email payment notifications describe the purchased item — membership-fee payments now show the group and fee name instead of empty ticket/activity/discount lines, and any line whose value can't be resolved (including the event link) is omitted rather than rendered blank.

## 0.3.1

### Patch Changes

-   7281a45: Centralize amount and currency formatting behind a shared `FairEventsShared\Money` helper (PHP) and matching `formatMoney`/`formatMoneyInline` helpers (JS), fixing the Fair Audience and Fair Events signup blocks, which previously hardcoded the € symbol regardless of the site's configured currency. A non-EUR site (e.g. PLN, CZK, HUF) now shows its real currency on ticket labels, add-on prices, and the running total — including after ticking an option, which previously reverted to €. EUR output is unchanged everywhere (signup blocks, emails, Timeline, Mollie payloads).

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
