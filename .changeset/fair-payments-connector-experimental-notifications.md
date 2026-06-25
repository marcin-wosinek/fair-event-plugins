---
"fair-payments-connector-experimental": minor
---

Replace the Telegram-only single-route notification system with a flexible multi-channel setup. Operators configure independent routes, each with a channel (email or Telegram), destination, frequency (immediate / hourly / daily / weekly), and PII inclusion toggle.

Key additions: `NotificationChannel` interface with `TelegramChannel` and `EmailChannel` implementations; a `fair_payment_notification_queue` table with `DigestHooks` cron flush; a `DigestBuilder` that prepends count and per-currency totals to batched bodies; a new `POST /fair-payments-connector/v1/notifications/test` REST endpoint; and a React route-list admin UI. Existing Telegram config is migrated automatically to an immediate route.
