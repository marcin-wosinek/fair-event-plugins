## 0.6.0

### Minor Changes

-   d20c34e: API tokens now come with Fair Payments Connector, so a site no longer needs Fair Payments Connector Experimental to share its transactions with other sites. Tokens are managed on a new **API Tokens** tab under Fair Payments Connector → Settings: generate a token, copy it while it is shown once, see when each token was last used, and revoke it after a confirmation that names the token. The tab and its dialogs work on phone-sized screens, and the Settings tabs wrap instead of squeezing.

    Existing tokens keep working and nothing has to be re-entered. The data sharing API keeps its addresses, responses and error codes, so sites that already import from this one need no change. New tokens can only read transactions: the unused "Read locations" permission is no longer offered, and a request for it is refused. An older token that still lists it keeps its transaction access and gains nothing else.

    Fair Payments Connector Experimental no longer has its own API Tokens page and is now only about Connected Sites, which work as before. The two plugins can be updated in either order: an older Fair Payments Connector Experimental keeps serving API tokens until it is updated, and an updated one keeps serving them for an older Fair Payments Connector, so there is always exactly one place to manage tokens.

## 0.5.0

### Minor Changes

-   b69bbb7: Add an External Updates page that runs Mollie payment imports, missing Mollie fee loading and connected-site imports from one place, with a persistent operation log of each run's source, action, initiator, outcome and counts. Only one update runs at a time, and partial or interrupted runs stay visible after a reload. Manual file imports remain on the Transactions page.
-   65d93ed: Payment notifications now come with Fair Payments Connector, so Fair Payments Connector Experimental is no longer needed for them. The Notifications page keeps its place in the Fair Payments Connector menu and its address. Telegram and email routes, the Telegram bot token, immediate and hourly/daily/weekly digest delivery, test messages and details added by other Fair Event plugins all work as before. Existing routes, the bot token and sales still waiting for a digest carry over without re-entering anything.

    Fair Payments Connector Experimental no longer includes payment notifications, and its Telegram settings screen and readme mention are removed. Notifications need Fair Payments Connector 2.3.0 or newer, so update Fair Payments Connector first or together with the experimental plugin. An older Fair Payments Connector Experimental release keeps sending notifications until it is updated. Fair Payments Connector Experimental still provides API tokens and connected sites.

### Patch Changes

-   f0c816c: Re-importing transactions from a connected site or an export file no longer clears Mollie fees. A fee already recorded on the receiving site, including zero, is kept; an imported fee only fills a missing one. Connected sites now share each transaction's Mollie fee, and imports from older sites that do not send it still work. Fees lost to earlier imports can be recovered with **Load missing Mollie fees** under External Updates, as described in the plugin README.

## 0.4.1

### Patch Changes

-   bf070ea: Fix daily, hourly and weekly sales digest emails never being delivered. The notification queue table was never created because its upgrade hook was registered too late to run, so every queued sale was silently dropped. The table is now created on `init`, each digest frequency has its own recurring event, and a digest is only marked sent once the channel reports success. A failed send keeps the sales queued with the attempt count and a sanitized error, an interrupted run is recovered after 30 minutes, and overlapping runs cannot send the same sale twice. Rows queued before this release keep their route's frequency.

## 0.4.0

### Minor Changes

-   1cda6dd: Add an optional Budget selector to each Connected Site, so a transaction imported from that site retains a durable link to its local id. During reconciliation, an unmatched imported transaction now shows its source site's configured budget, and the administrator can review, change, or clear that proposal before confirming a match — an existing budget assignment is always preserved, and no budget is proposed when selected transactions resolve to different sites. Removing a Connected Site or its linked budget never breaks existing data; both simply resolve to no budget going forward.

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
