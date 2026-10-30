# fair-payments-connector

## 2.7.0

### Minor Changes

- 625a7ec: The payment log now keeps entries for 90 days and stores less personal data.

    - Entries older than 90 days, including existing ones, are deleted by a daily WordPress cron job. Sites can change the window with the `fair_payment_log_retention_days` filter, for example `add_filter( 'fair_payment_log_retention_days', fn() => 30 );`. The job runs when WordPress cron runs, so sites that need it on time should trigger cron from a system scheduler.
    - New entries no longer record the visitor's IP address. Their details keep only diagnostic fields such as transaction, post and Mollie payment IDs, amount, currency, status and error codes; payment descriptions, checkout URLs and raw error text are left out.

- 56ba4ee: Reworked the notice shown after returning from checkout.

    - It appears only when no payment or ticket block on the page already shows the result, so buyers see one result per payment.
    - It checks the payment with the browser's saved payment credential and never reads or sends a token in the URL. When the status can't be checked, it says so instead of reporting a failed payment.
    - Messages are translatable, amounts follow the site language's money format, and the notice follows the theme's fonts and colors on every screen size. It stays until dismissed and can be closed with the keyboard.

- 0fb18d4: A new Privacy tab in payment settings controls whether Fair Events ticket payments send the buyer's email to the payment provider.

    - When it is off, new ticket payments, including retries, leave the email out of the payment metadata sent to Mollie. Transaction, event and signup references are still sent, and the email stays stored locally for registrations, participant matching and confirmation messages.
    - The choice applies to payment attempts made after it changes; it does not change data a provider already holds. Each change is recorded in the audit log.
    - New sites start with it off. Sites whose existing ticket payments already included buyer emails keep sending them until an administrator turns it off.

### Patch Changes

- 3c373a3: Failed connection tests and Mollie webhooks no longer reveal server file paths or internal error details. The connection test shows the technical details only when WP_DEBUG is on, and the full webhook error stays in the payment log.
- 5bc7dde: The Simple Payment block no longer puts the payment's access token in the return URL. The token proves that a visitor started the payment, and a URL can leak it to other sites through the `Referer` header, browser history and server logs. The block now keeps the token in the browser tab's session storage before sending the buyer to Mollie, and sends it in a request header when it checks the payment status.

    - After returning from Mollie, the block shows "processing" first, then the checked result. Reloading the page in the same tab still works.
    - If the status can't be checked (for example, the return link was opened in another browser), the block says so and asks the buyer to check their email or contact the organizer before paying again. It no longer suggests the payment failed.
    - If the browser blocks site data, the block won't start a payment. It asks the visitor to allow site data first, so nobody pays without seeing the result.
    - Signed-in buyers and administrators can still check a payment without the token.

    For flows that still put the token in their return URL, the status check keeps accepting it there for now.

- 6db7432: Admin screens no longer briefly show old state after an action has finished.

    - Event notifications: the "settings saved" notice, removing the old preview and clearing the "Unsaved changes" marker now happen together. The preview is also removed when a save changed nothing. The message shown after adding a notification goes away as soon as you open another view.
    - Payments settings: after a mode change, disconnect or reconnect, the Mollie profile and payment methods of the previous mode or connection are no longer shown.
    - Finance settlement import: a matched settlement report now shows with its suggested entry already selected.
    - Manage event Groups tab: switching events clears the previous event's rules, messages and selections at once, and a change still saving for the previous event no longer shows its result on the new one.

- Updated dependencies [5bc7dde]
    - fair-events-shared@0.7.1

## 2.6.0

### Minor Changes

- 68ef130: Each plugin now ships documentation of its blocks in `block-docs/`, matched
  to the release: `index.json` lists every block the plugin supplies, with its
  owning plugin, block.json, status, and when it is registered, and each block
  has a usage guide and serialized examples that open in the editor without
  validation errors. Site tooling and AI assistants can read these files from
  the installed plugin and compare them with the blocks a site reports through
  WordPress's authenticated `/wp/v2/block-types` endpoint.
- 21cf6c7: The Mollie access and refresh tokens are now stored encrypted (Sodium authenticated encryption, with a key derived from the site's WordPress security keys). Existing tokens are converted automatically on upgrade; no reconnection is needed, and checkout, automatic token refresh and test payments work as before. The shared package gains `FairEventsShared\Security\ProtectedOptions`, an opt-in way for any plugin to store a string option encrypted.

    - **Without Sodium support:** a site whose tokens are still stored as plaintext keeps working and keeps storing plaintext; the conversion runs once support is available.
    - **Losing Sodium support after conversion:** the encrypted tokens are kept unchanged, payments pause with a notice on the connection settings (visitors see "Online payment is temporarily unavailable"), and the connection resumes without reconnecting once support is restored.
    - **Changing the security keys or moving the database to another site:** the stored tokens can no longer be decrypted. The connection is shown as needing a reconnect instead of failing during checkout, and the unreadable values are left in place until you reconnect. If you rotate your WordPress keys routinely, reconnect Mollie afterwards.
    - **Limits:** this protects against partial leaks such as a table export, a settings export or a value copied into a log. When the WordPress security keys are not defined in `wp-config.php`, WordPress keeps them in the database, so a full database dump still contains what is needed to decrypt the tokens.

- 8192e1d: Upgrade the Mollie PHP SDK to v4. Both plugins now require PHP 8.2 or newer; update the server's PHP version before installing this release. Payments, webhooks, refunds shown on transactions, the Mollie connection and existing transactions and settlements work as before. Settlement imports now stop with a clear error, instead of finishing early or looping, when Mollie returns a next-page link that cannot be followed, a page cursor that was already loaded, or a report that cannot be read; continuing such an import never skips or repeats movements. A movement page that cannot be saved is retried on the next step instead of being skipped. Provider outages and unreadable Mollie responses during checkout, payment sync and payment import are reported as controlled errors.

### Patch Changes

- 1f4534e: Generating an API token now keeps its dialog open until the token is created. While it is generated, the dialog cannot be dismissed with Escape, the close button or a click outside, and a repeated submission cannot create a second token, so the token is never lost before you can copy it.
- f32a184: Moving a registration, changing its ticket type, editing a ticket and importing transactions now keep their popup open until the request finishes. While it runs, the popup cannot be dismissed or submitted twice and its fields are locked. A failure keeps your choices, reason or imported file in the popup, with the error shown inline, so you can retry. A failed transaction import offers **Retry import** without choosing the file again. A successful move, type change or ticket edit is now confirmed above the List.
- 24cb456: The Instagram access token and the Telegram bot token are now stored encrypted, the same way as the Mollie credentials (Sodium authenticated encryption, with a key derived from the site's WordPress security keys). Existing tokens are converted automatically on upgrade, whether or not the Instagram bundle or any Telegram route is enabled; nothing needs to be entered again. Instagram posting, connection tests and the daily token refresh, and Telegram notifications, work as before. The Instagram access token is no longer returned by the settings REST API (it was never shown on the settings screen); the Telegram bot token is still shown to administrators on the Notifications screen.

    - **Without Sodium support:** a site whose tokens are still stored as plaintext keeps working and keeps storing plaintext; the conversion runs once support is available.
    - **Losing Sodium support after conversion:** the encrypted tokens are kept unchanged. Instagram and Telegram notifications pause, the settings screens explain why, a new token cannot be saved until support returns, and both resume without re-entering anything once it does.
    - **Changing the security keys or moving the database to another site:** the stored tokens can no longer be decrypted. Instagram is shown as needing a reconnection (connect again or enter a new access token), and the Notifications screen asks for the bot token to be entered again; until then nothing is sent. The unreadable values are left in place until they are replaced, or until Instagram is disconnected. If you rotate your WordPress keys routinely, reconnect Instagram and re-enter the Telegram bot token afterwards.
    - **Limits:** this protects against partial leaks such as a table export, a settings export or a value copied into a log. When the WordPress security keys are not defined in `wp-config.php`, WordPress keeps them in the database, so a full database dump still contains what is needed to decrypt the tokens.

- b3ce35a: Reconcile saved API and CSV settlements locally with explicit bank context, exact payout explanations, partial decisions, immutable confirmation evidence, stale-preview protection, and optional supported allocations. Preserve existing CSV reconciliation and manual allocations, and guard account convergence while saved bank associations depend on it.
- 6b51b60: The public payment endpoints are now rate limited per visitor IP address, so a script can no longer create unlimited payments in your Mollie account or flood the payment log. Each limit has its own one-minute window, and a request over the limit gets a "Too many requests" answer (HTTP 429) saying how many seconds to wait.

    - **Starting a payment** (Simple Payment block): 10 attempts a minute.
    - **Loading the payment form's security token:** 60 requests a minute.
    - **Mollie webhook calls with a missing, malformed or unknown payment ID:** 30 a minute. Webhooks for real payments are never limited, and unknown IDs never reach Mollie. Once the limit is reached, further bogus calls are no longer written to the payment log.

    Visitors who share an address (an office network or a mobile carrier) share these limits. If your site runs behind a reverse proxy or CDN, make sure the web server passes the real visitor address; otherwise every visitor counts as the proxy.

- f95eda6: Event dates are now stored and exchanged only as dates with optional start and end times. The `start_datetime` and `end_datetime` fields are gone from the `fair-events/v1/event-dates` API: requests that send them are rejected, and responses no longer include them. List sorting uses `orderby=start_date`. The public events feed sends `start` and `end` only for a time that is set (or the day boundaries of an all-day event), and `null` instead of an invented midnight. Events imported from another Fair Events site without a start time are no longer skipped. On upgrade, the old datetime columns are removed once every event date has been converted. Admin screens, emails and date labels across the plugins show a time only when one is set.
- b05c7e3: Event lists, session status and metadata now read event dates with optional times. A date without an end time stays current and upcoming through its end date and is past from the next day, in every events list view. A timed date missing its start time stays upcoming until it ends. JSON-LD and Open Graph show a bare date where a time is missing, and for all-day events, instead of a midnight timestamp. A whole-series pass bought on the start date of a date without a start time covers it. Scheduled mailings anchored to a time that is not set wait without a send time and are rescheduled when the time is set. Signup emails and the mailing event picker show only the date when there is no start time. Events imported from another Fair Events site keep their dates and optional times.
- f7cce69: Recently added text is now translated on sites running in German, Spanish, French or Polish: the notification history and search, the Other Sessions block, the weekly email notices, Mollie and Telegram encryption warnings, and smaller messages that had stayed in English.
- Updated dependencies [f32a184]
- Updated dependencies [21cf6c7]
- Updated dependencies [79f6ea4]
- Updated dependencies [d6adc05]
- Updated dependencies [f95eda6]
- Updated dependencies [157e1ea]
- Updated dependencies [b05c7e3]
    - fair-events-shared@0.7.0

## 2.5.0

### Minor Changes

- dcdef69: Loading Mollie settlements now starts with **Load new**: it brings in only
  the settlements that are not saved yet and leaves the ones already loaded
  from Mollie unchanged, saying so when nothing new was found. **Reload all**
  stays available as the lesser action for retrieving every settlement again.

    An import that failed or was interrupted can be continued or replaced by
    another import. After a failed request the page reads the import back from
    the server instead of leaving its buttons disabled, and an import the server
    still counts as running is shown as such with a way to refresh its status.

    While Fair Finance is active, the External Updates page of Fair Payments
    Connector has a **Mollie settlements** section that loads new settlements
    and continues an import left unfinished on either page. Settlement imports
    appear in its operation log, one entry per import.

- 8e7c2de: **Create test payment** in live mode now asks for confirmation in a dialog instead of the browser's own confirmation box. The dialog shows the actual amount and currency, the Mollie profile name, profile ID and organization ID, and the warning about real money and gateway fees. Cancelling creates no payment. If the mode, currency or connected account changes after the dialog opens, no payment is created and the dialog shows the current details for a new confirmation. Test-mode payments are still created right away.

    **Disconnect Mollie** now names the connected profile and account, or says "the connected Mollie account" when they are not known. It explains that the site cannot create Mollie payments or receive status updates for existing ones until it reconnects, and that payments already in Mollie are not cancelled or refunded. If the disconnect succeeds but its audit entry cannot be recorded, the page now shows the site as disconnected instead of inviting a retry.

    **Delete local transaction** now names the transaction by ID, amount and currency, and by its description when it has one. The dialog still explains that only the local record is removed.

    In all three dialogs, the dialog stays open while the action runs, a failure is shown inside the dialog, and repeated clicks cannot send the action twice.

- 6906403: Save Mollie settlements on your site. A new Settlements page in Fair Finance loads payouts from Mollie or from a settlement CSV export, keeps them available without a Mollie connection, and shows where the two sources agree or differ.
- f00414c: **Transactions** now link each matched financial entry reference to the Fair Finance **Financial Entries** screen, narrowed to that entry. This includes entries that are part of a split. The references are links only while Fair Finance is active; otherwise they stay plain text.

    **Financial Entries** opened for a single entry shows "Showing entry #N" with a **Show all entries** action, hides the filters and tag chart, and limits the totals and CSV export to that entry. A split parent keeps its nested children and is counted once in the totals. A missing entry shows an explanation, and an invalid entry link shows an error instead of the full list.

    `GET /fair-finance/v1/financial-entries` and `/financial-entries/totals` accept an optional `entry_id` (a positive integer). It takes precedence over the other filters.

### Patch Changes

- 9321736: Reorder the Fair Payments Connector menu so configuration comes last:
  Transactions, External Updates, Dashboard, Connected Sites (with Fair Payments
  Connector Experimental), Notifications, Settings. "Fee Dashboard" is renamed
  to "Dashboard" in the menu and the page heading, and the page's text is now
  translated like the other admin pages. Page addresses and permissions are
  unchanged.
- e25afe2: Settlements loaded from Mollie keep the report amounts exactly as Mollie
  states them, including fees, VAT and rounding differences with fractions of a
  cent, which used to be saved as unknown. A saved settlement now opens with a
  settlement summary: reported revenue, refunds, costs and adjustments, the
  report net, the payout and the exact difference between them. The Mollie
  report breakdown lists every line by period with its count, rates, net, VAT
  and gross amounts and invoice reference. Settlements saved before this
  update show "Refresh to load report details"; refreshing them from Mollie
  loads the details.
- e1f6379: Fix the participant link in the sample notification sent by "Send test
  message". It pointed at a page that does not exist; it now opens the Fair
  Audience participants list.

## 2.4.0

### Minor Changes

- d20c34e: API tokens now come with Fair Payments Connector, so a site no longer needs Fair Payments Connector Experimental to share its transactions with other sites. Tokens are managed on a new **API Tokens** tab under Fair Payments Connector → Settings: generate a token, copy it while it is shown once, see when each token was last used, and revoke it after a confirmation that names the token. The tab and its dialogs work on phone-sized screens, and the Settings tabs wrap instead of squeezing.

    Existing tokens keep working and nothing has to be re-entered. The data sharing API keeps its addresses, responses and error codes, so sites that already import from this one need no change. New tokens can only read transactions: the unused "Read locations" permission is no longer offered, and a request for it is refused. An older token that still lists it keeps its transaction access and gains nothing else.

    Fair Payments Connector Experimental no longer has its own API Tokens page and is now only about Connected Sites, which work as before. The two plugins can be updated in either order: an older Fair Payments Connector Experimental keeps serving API tokens until it is updated, and an updated one keeps serving them for an older Fair Payments Connector, so there is always exactly one place to manage tokens.

- 3a7b83d: Calculate signup and payment totals in one way. The amount saved with a signup, whether it is free or paid, the amount charged and the line items recorded in the finance ledger now all come from the same calculation: amounts have two decimals and are rounded half up — each unit price first, then each line, then the total. Purchases at ordinary two-decimal prices are unchanged.

    A price with a fraction of a cent (for example after a discount) can now differ by a cent from what one of these places showed before, and a total that rounds to zero is confirmed as free instead of being sent to payment. In a purchase for several dates, each date's signup now holds its own rounded amount.

    For developers: a transaction's amount is always the total of its line items. `fair_payment_before_validate_line_items` may still change the line items, which are validated again; a total changed through `fair_payment_calculated_total` or `fair_payment_before_create_transaction` without matching line items is refused. Line items may now be negative (discounts) or zero as long as the total is positive, and a quantity must be a positive whole number. `fair_payment_create_transaction()` accepts `expected_amount` to refuse a transaction whose total differs from the amount the caller decided on.

- bc63391: Request Mollie settlement access when Fair Finance is active. Connecting to Mollie asks for the same permissions as before, plus permission to read settlements on sites running Fair Finance. The site records the permissions Mollie actually granted and treats settlement access as available only when that permission was granted.

    A site connected before this change keeps accepting payments. Its connection settings now offer **Reconnect**, which goes through the Mollie authorization again without disconnecting first, and Fair Finance's Reconciliation page explains when settlement access still needs to be authorized and links there. Cancelling or failing an authorization leaves the existing connection as it was and says so, instead of ending on an error page.

- 3cbb450: Payment Transactions: search by transaction ID, Mollie payment ID, description, or the person's name or email, and filter by date and amount range. Filters apply together with Status and Mode, show the number of matching transactions, and reset to the Paid / Live defaults.

### Patch Changes

- 9413f36: Load the plugins' own scripts with WordPress's `defer` strategy. The Add to Calendar button script, the payment return notification script, and the admin and editor scripts of these plugins no longer pause page parsing while they download; they stay in the footer and behave as before. WordPress still loads a script the usual way where deferring would break ordering — Manage Event while a plugin adds tabs to it (Fair Audience does), and Fair Events → Settings while an extension adds a settings tab.

## 2.3.0

### Minor Changes

- b69bbb7: Add an External Updates page that runs Mollie payment imports, missing Mollie fee loading and connected-site imports from one place, with a persistent operation log of each run's source, action, initiator, outcome and counts. Only one update runs at a time, and partial or interrupted runs stay visible after a reload. Manual file imports remain on the Transactions page.
- c134f96: The Fee Dashboard is now a monthly statistics page. Organizers can move between months and see paid transaction count, total paid, recorded Fair Event commission, recorded Mollie commission, and a calculated amount after fees, shown separately for each currency. Figures are marked incomplete, with a count of affected transactions, while Mollie fee data or a Fair Event commission is still missing, and they update when fees arrive later. Only paid transactions count, in the month they were created (UTC). The `/fair-payments-connector/v1/dashboard/monthly-summary` endpoint accepts an optional `month` (`YYYY-MM`) and now returns a `currencies` array instead of `total_volume` and `total_fees`. Pending transactions no longer add to the integration-fee total.
- 65d93ed: Payment notifications now come with Fair Payments Connector, so Fair Payments Connector Experimental is no longer needed for them. The Notifications page keeps its place in the Fair Payments Connector menu and its address. Telegram and email routes, the Telegram bot token, immediate and hourly/daily/weekly digest delivery, test messages and details added by other Fair Event plugins all work as before. Existing routes, the bot token and sales still waiting for a digest carry over without re-entering anything.

    Fair Payments Connector Experimental no longer includes payment notifications, and its Telegram settings screen and readme mention are removed. Notifications need Fair Payments Connector 2.3.0 or newer, so update Fair Payments Connector first or together with the experimental plugin. An older Fair Payments Connector Experimental release keeps sending notifications until it is updated. Fair Payments Connector Experimental still provides API tokens and connected sites.

### Patch Changes

- f0c816c: Re-importing transactions from a connected site or an export file no longer clears Mollie fees. A fee already recorded on the receiving site, including zero, is kept; an imported fee only fills a missing one. Connected sites now share each transaction's Mollie fee, and imports from older sites that do not send it still work. Fees lost to earlier imports can be recovered with **Load missing Mollie fees** under External Updates, as described in the plugin README.
- f62e157: Let a participant buy tickets again for a date they already hold a ticket for. Each purchase keeps its own signup, tickets and payment. The Event Signup form now protects against accidental repeats instead: submitting the same purchase twice, or retrying after a lost connection or a payment that could not be started, continues the first purchase and never charges twice. After an error message the form can be submitted again without reloading the page.
- 02c95eb: Restore the "Load missing Mollie fees" button on the Transactions page. It follows the page's Mode filter, and each run now appears in the External Updates operation log.
- 78727b4: Pages with the Mailing Signup, Fair Form, or Simple Payment block load much less JavaScript. These blocks no longer load the block editor's component library for visitors. The forms and the payment button work as before.

## 2.2.0

### Minor Changes

- 67f7bf6: The integration fee becomes a flat 2% of ticket sales with no monthly cap. It stays waived for transactions created before 1 January 2027 (midnight in the site timezone); from then on, each new transaction records a 2% fee. Fees already recorded on existing or imported transactions are never recalculated, and Mollie's processing fees remain separate.

    The Fee Dashboard now explains the new pricing and shows only this month's payment volume and integration fees. The monthly cap meter, remaining allowance, and active-plan breakdown are gone, and the `/fair-payments-connector/v1/dashboard/monthly-summary` response no longer includes `fee_cap`, `cap_remaining`, or `plan_breakdown`. The `fair_payment_active_plugin_prices` filter has been removed. Pricing copy in both plugin readmes is updated to match.

## 2.1.0

### Minor Changes

- 19d0333: Add an audit log for Fair Payments Connector settings and Mollie connection changes. Every successful manual change — saving the mode, currency, or bank-transfer settings, or connecting, reconnecting, or disconnecting Mollie — is recorded with a server-generated description; automated changes (token refresh, connection loss) are attributed to the system. A new Audit Log tab on the settings page shows the paginated history, redacting protected values such as OAuth tokens. The shared Settings → Fair Event Plugins screen gained an optional per-field `requires_reason` flag and a `fair_event_plugins_setting_changed` action so a plugin can record its own audit entry when its field changes there — both are additive and don't affect plugins that don't use them; this plugin's own bundled-translations row does not use the flag.
- 28d4fd9: Add a "Delete transaction" action to the transaction detail page so administrators can permanently remove a local transaction record, such as one imported by mistake. Deletion only affects local WordPress data — it never cancels, refunds, or otherwise modifies the corresponding payment in Mollie or any other external service.
- a619b61: Add a responsive administrator flow for selecting and importing paid transactions directly from the connected Mollie account.
- 1cda6dd: Add an optional Budget selector to each Connected Site, so a transaction imported from that site retains a durable link to its local id. During reconciliation, an unmatched imported transaction now shows its source site's configured budget, and the administrator can review, change, or clear that proposal before confirming a match — an existing budget assignment is always preserved, and no budget is proposed when selected transactions resolve to different sites. Removing a Connected Site or its linked budget never breaks existing data; both simply resolve to no budget going forward.
- e3fa379: Add an "Event" field to the transaction view so an admin can search for, link, or clear the event date a transaction relates to — including linking a specific occurrence of a recurring event. The link is validated server-side against Fair Events when it's active.
- 15ff1d1: Show a non-dismissible warning across every active Fair Event Plugins admin page (including the shared Settings → Fair Event Plugins screen and Fair Events post-type screens) when Fair Payments Connector is not ready to process real payments — no Mollie account connected, or setup incomplete (missing profile ID or still in test mode) — linking to the connector's settings page. Replaces the connector's own test-mode-only notice with this single, suite-wide notice path.

### Patch Changes

- 38d61eb: Import missing Mollie transaction fee data in batches of 10 instead of one request per transaction, so large fee synchronizations are faster and less vulnerable to interrupted connections.
- Updated dependencies [19d0333]
    - fair-events-shared@0.6.2

## 2.0.2

### Patch Changes

- 21bb8d8: Store newly initiated payment timestamps in UTC so transaction times display consistently in the configured site timezone.
- Updated dependencies [a96d4f1]
    - fair-events-shared@0.6.1

## 2.0.1

### Patch Changes

- 70445e4: Include the validated ticket buyer email in Mollie metadata while omitting unresolved participant and local user identifiers.

## 2.0.0

### Major Changes

- b92cd39: Remove Mollie API key authentication in favour of the guided OAuth connection. Stored test/live API keys are deleted on upgrade and are no longer accepted through the settings API; a site that only had a key (no guided connection) sees a one-off notice explaining that it needs to reconnect Mollie, and stops being able to take payments until it does.

### Patch Changes

- 7622d31: Fix a mischarge bug where duplicating a Simple Payment block copied its hidden identifier along with it: the editor now reassigns a fresh identifier to the duplicate and warns the owner to save, and the payment endpoint rejects a payment when the submitted identifier matches more than one saved block instead of trusting the first match.
- Updated dependencies [4b9d893]
- Updated dependencies [4ec1056]
- Updated dependencies [49f2e0a]
- Updated dependencies [aeda159]
- Updated dependencies [f64745d]
- Updated dependencies [7932bb2]
    - fair-events-shared@0.6.0

## 1.7.0

### Minor Changes

- 3e696d0: Move the "Bundled translations" toggle out of each plugin's own settings screen into a single shared **Settings → Fair Event Plugins** screen that lists one row per active plugin. Previously saved values keep working unchanged. fair-audience and fair-payments-connector lose their Features tab (bundled-translations was its only entry); fair-timetable loses its whole Settings page; fair-platform loses its Features submenu. fair-events keeps its Features tab for the Ticketing bundle. The experimental companion plugins (fair-events-experimental, fair-audience-experimental, fair-payments-connector-experimental) now always load their bundled translation files instead of waiting on a WordPress.org language pack that will never exist for them.

### Patch Changes

- 7281a45: Centralize amount and currency formatting behind a shared `FairEventsShared\Money` helper (PHP) and matching `formatMoney`/`formatMoneyInline` helpers (JS), fixing the Fair Audience and Fair Events signup blocks, which previously hardcoded the € symbol regardless of the site's configured currency. A non-EUR site (e.g. PLN, CZK, HUF) now shows its real currency on ticket labels, add-on prices, and the running total — including after ticking an option, which previously reverted to €. EUR output is unchanged everywhere (signup blocks, emails, Timeline, Mollie payloads).
- f0aa452: Fixed broken links left over from the Budgets/Entries/Reconciliation screens' move from Payments Connector into Finance: the budgets list's "View" links (for a specific budget and for unbudgeted entries) now point at the current `fair-finance-entries` admin page instead of the retired, unregistered slug that produced a permissions-denied page. The transactions list's entry column, whose deep link into a specific entry never actually worked, now shows the entry ids as plain text instead of a dead link.
- 8d196d7: Reject a payment request whose `block_id` is empty instead of matching it against any legacy simple-payment block with the same blank saved id — closes a mischarge risk on pages with more than one such block. The block editor also now warns with a save prompt when a simple-payment block is missing its id, since the id is only fixed in the published post once it's re-saved.
- 5a55c92: Security: Mollie OAuth access and refresh tokens are no longer readable or writable through `/wp/v2/settings` (they were previously returned in full to any `manage_options` user despite a REST context scope that had no effect). Disconnecting from Mollie now goes through a dedicated `oauth/disconnect` endpoint instead of clearing the tokens via the settings REST route.
- Updated dependencies [7281a45]
- Updated dependencies [84cfda0]
- Updated dependencies [8d196d7]
- Updated dependencies [9ae94d2]
- Updated dependencies [1f9fcc1]
    - fair-events-shared@0.5.0

## 1.6.0

### Minor Changes

- a7c09e1: Add a one-click "Create test payment" button on the connector settings connection tab to exercise the full payment flow without building a page, show the connected Mollie profile name and enabled methods on that tab, and link out to the org-specific Mollie payment methods page instead of the generic dashboard root. Sanitize Mollie's raw gateway error responses before they reach visitors, showing everyone a generic message while a capability-checked admin also gets an interpreted cause and fix-it links, with full detail still going to the payment log. Fix a 403 fetching the Mollie profile under an org-level OAuth token, reword the test-payment description in plain language, and standardize the Simple Payment block's button on core Button styles.

### Patch Changes

- Updated dependencies [a7c09e1]
    - fair-events-shared@0.4.0

## 1.5.2

### Patch Changes

- 6973be8: Rewrite the readme for WordPress.org and convert hand-rolled admin notices to wp_admin_notice().

## 1.5.1

### Patch Changes

- 612b9b0: Fix duplicate Telegram payment notifications when a Mollie webhook and the page-load status sync raced to mark the same transaction paid. `Transaction::update_status()` now performs a compare-and-swap update against an expected prior status, so only the caller that wins the race fires the `fair_payment_paid` hook.
- Updated dependencies [b007d8a]
- Updated dependencies [612b9b0]
- Updated dependencies [612b9b0]
    - fair-events-shared@0.3.0

## 1.5.0

### Minor Changes

- 2cb0fb8: Add a shared payment-integration lifecycle layer in fair-events-shared that standardizes how plugins hook into payment start, completion, and failure. fair-payments-connector's simple-payment block and fair-events' get-tickets block consume the shared layer so payment side-effects are handled consistently across integrations.
- 2cb0fb8: Waive the platform fee until 2027-01-01: transactions created before that date are charged no platform fee. The fee calculation and its persisted amount both account for the waiver window.

### Patch Changes

- ce4566c: Fix the simple-payment block rejecting every purchase with "Block not found." Since the block-id/amount verification was added to the payment endpoint, render.php overwrote the saved blockId attribute with a per-render `wp_unique_id()` before printing the button's `data-block-id`, so the submitted id could never match the block in post content and the endpoint returned 403. The unique id is now used only for the wrapper's DOM id; the button submits the real blockId attribute. Caught by the new simple-payment e2e spec — the API specs only covered the rejection paths.
- Updated dependencies [2cb0fb8]
    - fair-events-shared@0.2.0

## 1.4.0

### Minor Changes

- c60efeb: Cap the 1 % application fee at the operator's monthly allowance: once the cap is reached, the fee drops to zero for the remainder of the month.

    Fix testmode payments: Mollie PHP SDK v3 reads `testmode` from the third argument of `payments->create()`, not from the payload body. Placing it in the payload was silently ignored, causing every payment to be created live regardless of the `fair_payment_mode` setting.

### Patch Changes

- c60efeb: Block paid-event signup when the payment connector is not configured. Previously `maybe_start_paid_signup()` and `maybe_start_addon_payment()` fell through to the free path whenever the resolved total reached zero — which happened when the EventSignupPricing service was unavailable or unconfigured, silently granting free access to paid events.

    Adds `TransactionAPI::is_configured()` (delegating to `MolliePaymentHandler::is_configured()`) and `EventSignupPricing::has_paid_price_configured()` so both conditions are checked before allowing a zero-total signup to proceed.

## 1.3.0

### Minor Changes

- f46e6ec: Add UX improvements for unconfigured Mollie state: show a "not set up" admin notice, a "Set up" link on the plugins list page, and a "Need help?" link on the settings page.
- aec8208: Add OAuth state parameter to prevent CSRF credential replacement in the Mollie connection flow.
- fb3165c: Add a site-wide default currency setting. Admins can now choose the currency (EUR, USD, GBP, CHF, DKK, NOK, SEK, PLN, CZK, HUF) in Fair Payments Connector → Settings → Currency; all new transactions, fees, and price displays across the plugins inherit this setting instead of being hard-coded to EUR.

### Patch Changes

- f46e6ec: Security hardening: protect the payment endpoint with a block nonce and a server-side amount floor, restrict Mollie API keys to edit context in the REST API, and guard the webhook handler against terminal-state replays.

## 1.2.0

### Minor Changes

- ead4d69: Upgrade Mollie API client v2→v3; fix transaction timestamp timezone display; reorder admin menu to Transactions, Fee Dashboard, Settings; remove Advanced Settings tab; defer Mollie registration to plugins_loaded

## 1.1.0

### Minor Changes

- 17770eb: Split budgets, financial entries, and reconciliation out of fair-payments-connector into a new fair-finance plugin. fair-finance introduces the plugin from scratch (major); fair-payments-connector loses the extracted functionality (minor).
- f9e4993: Add Fee Dashboard admin page with monthly-summary REST endpoint, MonthlyFeeCapService, fee cap fields in dashboard summary, and lower platform fee to 1% with updated monthly caps.

## 1.0.1

### Patch Changes

- 3f6c9e2: Fix WordPress.org build review issues: stamp Stable tag in readme.txt to match plugin version, exclude webpack.config.cjs from dist archive, and lower admin menu position to 56.

## 1.0.0

### Major Changes

- 9fd5497: Rename the `fair-payment` plugin to `fair-payments-connector`. WordPress.org review flagged "Fair Payment" as too generic; the new name positions it accurately as a connector to external payment providers and stays consistent with the `fair-*` family.

    Renamed (code-level): directory `fair-payment/` → `fair-payments-connector/`, main file, plugin slug, text domain, REST namespace `/fair-payment/v1/` → `/fair-payments-connector/v1/`, PHP namespace `FairPayment` → `FairPaymentsConnector`, constants `FAIR_PAYMENT_*` → `FAIR_PAYMENTS_CONNECTOR_*`, init function, display name.

    Preserved (to avoid destructive migrations / breaking existing content): block name `fair-payment/simple-payment`, all DB option keys (`fair_payment_*`), custom table names, post meta keys, and the `fair_payment_callback` URL parameter consumed by Mollie callbacks. Cross-plugin REST calls and PHP function references in sibling plugins are tracked in a separate ticket.

### Patch Changes

- 02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
  `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
  feature flag (resolved through the same constant / master / filter / option /
  default chain as the existing Fair Events features). The flag is exposed in
  each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 1.3.3

### Patch Changes

- 9dadc92: Document external services (Mollie API, Fair Event Plugins OAuth proxy, Telegram Bot API) in readme.txt per WordPress.org plugin review requirements.
- 59a6d62: Gate `/payments/{id}/status` with a per-transaction access token so transaction IDs cannot be enumerated. The token is generated at creation time, propagated through the Mollie redirect URL, and required for anonymous reads. Logged-in admins and the transaction's owner can still read without a token.
- 0ebaea4: Group admin menus with string positions to avoid overwriting core menus

    Each plugin's top-level admin menu now registers with a unique string decimal
    position (`20.1`–`20.4`) so the four menus cluster together in order without
    colliding with each other or with core WordPress menu items.

## 1.3.2

### Patch Changes

- c309dcf: Add `defined( 'ABSPATH' ) || exit;` guard to the simple-payment block's `render.php` so Plugin Check's `missing_direct_file_access_protection` error is cleared.
- eb53475: Bump minimum WordPress version to 6.2 so the `%i` identifier placeholder used in `$wpdb->prepare()` is supported on the declared floor, clearing Plugin Check `UnsupportedIdentifierPlaceholder` errors before publishing.

## 1.3.1

## 1.3.0

### Minor Changes

- 7f6ab85: Add Connected Sites for cross-site transaction data sharing: a data-sharing API exposing transactions to authorised sites, a consumer side that pulls from connected sites, and a Mollie settlement CSV import. Transaction import now lets you choose a connected-site or file source.
- 7682a28: Add a setting to disable bank-transfer payment close to the event date.
- 7f6ab85: Overhaul reconciliation splitting and allocations: auto-split a matched entry into one child per transaction, allow negative and adjustment allocations, store allocation amounts with their original sign, allow nonzero amounts when editing a split, tick the transaction on automatic matching, and add a bulk "Load Missing Mollie Fees" action to the transactions list.
- 7f6ab85: Send Telegram notifications for successful transactions, with test-mode payments clearly marked.
- 7f6ab85: Enrich transaction export: include the event URL as `detail_url`, carry the source `event_date_id`, and rename the entry "event" label to "link" so it is inherited on match.

### Patch Changes

- 7f6ab85: Miscellaneous fixes: link to the event page from the admin calendar, close the payment callback popup without a page reload, integrate the confirm & save buttons in the edit popup, keep a cancelled signup registered as "interested", remove the email from the purchase message, and stop nulling transactions.
- 7f6ab85: Update the local Docker environment and "Tested up to" headers to WordPress 7.

## 1.2.0

### Minor Changes

- d04f565: Transaction reconciliation improvements. Import Mollie transaction reports, display links from transactions to budget entries, link payments to participants via typeahead with an option to update missing participants, and limit reconciliation to live (production) mode.
- 41a295c: Add payment error logging. New `PaymentLog` model with database schema, REST endpoint, and admin log viewer on the transaction page. Mollie webhook and payment endpoints record errors for troubleshooting.

## 1.1.1

### Patch Changes

- c8a6a54: Improve the mobile UI for transactions.

## 1.1.0

## 0.2.0

### Minor Changes

- 3abfc47: Add application fee to transactions.
- 457cd90: Show transation result when open call payment callback.
- e61b58c: Add advanced settings view, to simplify troubleshooting

### Patch Changes

- a25d6c7: Move Mollie payment integration to OAuth & Mollie Connect.
