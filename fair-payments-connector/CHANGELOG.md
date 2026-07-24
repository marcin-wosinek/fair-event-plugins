# fair-payments-connector

## 1.6.0

### Minor Changes

-   a7c09e1: Add a one-click "Create test payment" button on the connector settings connection tab to exercise the full payment flow without building a page, show the connected Mollie profile name and enabled methods on that tab, and link out to the org-specific Mollie payment methods page instead of the generic dashboard root. Sanitize Mollie's raw gateway error responses before they reach visitors, showing everyone a generic message while a capability-checked admin also gets an interpreted cause and fix-it links, with full detail still going to the payment log. Fix a 403 fetching the Mollie profile under an org-level OAuth token, reword the test-payment description in plain language, and standardize the Simple Payment block's button on core Button styles.

### Patch Changes

-   Updated dependencies [a7c09e1]
    -   fair-events-shared@0.4.0

## 1.5.2

### Patch Changes

-   6973be8: Rewrite the readme for WordPress.org and convert hand-rolled admin notices to wp_admin_notice().

## 1.5.1

### Patch Changes

-   612b9b0: Fix duplicate Telegram payment notifications when a Mollie webhook and the page-load status sync raced to mark the same transaction paid. `Transaction::update_status()` now performs a compare-and-swap update against an expected prior status, so only the caller that wins the race fires the `fair_payment_paid` hook.
-   Updated dependencies [b007d8a]
-   Updated dependencies [612b9b0]
-   Updated dependencies [612b9b0]
    -   fair-events-shared@0.3.0

## 1.5.0

### Minor Changes

-   2cb0fb8: Add a shared payment-integration lifecycle layer in fair-events-shared that standardizes how plugins hook into payment start, completion, and failure. fair-payments-connector's simple-payment block and fair-events' get-tickets block consume the shared layer so payment side-effects are handled consistently across integrations.
-   2cb0fb8: Waive the platform fee until 2027-01-01: transactions created before that date are charged no platform fee. The fee calculation and its persisted amount both account for the waiver window.

### Patch Changes

-   ce4566c: Fix the simple-payment block rejecting every purchase with "Block not found." Since the block-id/amount verification was added to the payment endpoint, render.php overwrote the saved blockId attribute with a per-render `wp_unique_id()` before printing the button's `data-block-id`, so the submitted id could never match the block in post content and the endpoint returned 403. The unique id is now used only for the wrapper's DOM id; the button submits the real blockId attribute. Caught by the new simple-payment e2e spec — the API specs only covered the rejection paths.
-   Updated dependencies [2cb0fb8]
    -   fair-events-shared@0.2.0

## 1.4.0

### Minor Changes

-   c60efeb: Cap the 1 % application fee at the operator's monthly allowance: once the cap is reached, the fee drops to zero for the remainder of the month.

    Fix testmode payments: Mollie PHP SDK v3 reads `testmode` from the third argument of `payments->create()`, not from the payload body. Placing it in the payload was silently ignored, causing every payment to be created live regardless of the `fair_payment_mode` setting.

### Patch Changes

-   c60efeb: Block paid-event signup when the payment connector is not configured. Previously `maybe_start_paid_signup()` and `maybe_start_addon_payment()` fell through to the free path whenever the resolved total reached zero — which happened when the EventSignupPricing service was unavailable or unconfigured, silently granting free access to paid events.

    Adds `TransactionAPI::is_configured()` (delegating to `MolliePaymentHandler::is_configured()`) and `EventSignupPricing::has_paid_price_configured()` so both conditions are checked before allowing a zero-total signup to proceed.

## 1.3.0

### Minor Changes

-   f46e6ec: Add UX improvements for unconfigured Mollie state: show a "not set up" admin notice, a "Set up" link on the plugins list page, and a "Need help?" link on the settings page.
-   aec8208: Add OAuth state parameter to prevent CSRF credential replacement in the Mollie connection flow.
-   fb3165c: Add a site-wide default currency setting. Admins can now choose the currency (EUR, USD, GBP, CHF, DKK, NOK, SEK, PLN, CZK, HUF) in Fair Payments Connector → Settings → Currency; all new transactions, fees, and price displays across the plugins inherit this setting instead of being hard-coded to EUR.

### Patch Changes

-   f46e6ec: Security hardening: protect the payment endpoint with a block nonce and a server-side amount floor, restrict Mollie API keys to edit context in the REST API, and guard the webhook handler against terminal-state replays.

## 1.2.0

### Minor Changes

-   ead4d69: Upgrade Mollie API client v2→v3; fix transaction timestamp timezone display; reorder admin menu to Transactions, Fee Dashboard, Settings; remove Advanced Settings tab; defer Mollie registration to plugins_loaded

## 1.1.0

### Minor Changes

-   17770eb: Split budgets, financial entries, and reconciliation out of fair-payments-connector into a new fair-finance plugin. fair-finance introduces the plugin from scratch (major); fair-payments-connector loses the extracted functionality (minor).
-   f9e4993: Add Fee Dashboard admin page with monthly-summary REST endpoint, MonthlyFeeCapService, fee cap fields in dashboard summary, and lower platform fee to 1% with updated monthly caps.

## 1.0.1

### Patch Changes

-   3f6c9e2: Fix WordPress.org build review issues: stamp Stable tag in readme.txt to match plugin version, exclude webpack.config.cjs from dist archive, and lower admin menu position to 56.

## 1.0.0

### Major Changes

-   9fd5497: Rename the `fair-payment` plugin to `fair-payments-connector`. WordPress.org review flagged "Fair Payment" as too generic; the new name positions it accurately as a connector to external payment providers and stays consistent with the `fair-*` family.

    Renamed (code-level): directory `fair-payment/` → `fair-payments-connector/`, main file, plugin slug, text domain, REST namespace `/fair-payment/v1/` → `/fair-payments-connector/v1/`, PHP namespace `FairPayment` → `FairPaymentsConnector`, constants `FAIR_PAYMENT_*` → `FAIR_PAYMENTS_CONNECTOR_*`, init function, display name.

    Preserved (to avoid destructive migrations / breaking existing content): block name `fair-payment/simple-payment`, all DB option keys (`fair_payment_*`), custom table names, post meta keys, and the `fair_payment_callback` URL parameter consumed by Mollie callbacks. Cross-plugin REST calls and PHP function references in sibling plugins are tracked in a separate ticket.

### Patch Changes

-   02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
    `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
    feature flag (resolved through the same constant / master / filter / option /
    default chain as the existing Fair Events features). The flag is exposed in
    each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 1.3.3

### Patch Changes

-   9dadc92: Document external services (Mollie API, Fair Event Plugins OAuth proxy, Telegram Bot API) in readme.txt per WordPress.org plugin review requirements.
-   59a6d62: Gate `/payments/{id}/status` with a per-transaction access token so transaction IDs cannot be enumerated. The token is generated at creation time, propagated through the Mollie redirect URL, and required for anonymous reads. Logged-in admins and the transaction's owner can still read without a token.
-   0ebaea4: Group admin menus with string positions to avoid overwriting core menus

    Each plugin's top-level admin menu now registers with a unique string decimal
    position (`20.1`–`20.4`) so the four menus cluster together in order without
    colliding with each other or with core WordPress menu items.

## 1.3.2

### Patch Changes

-   c309dcf: Add `defined( 'ABSPATH' ) || exit;` guard to the simple-payment block's `render.php` so Plugin Check's `missing_direct_file_access_protection` error is cleared.
-   eb53475: Bump minimum WordPress version to 6.2 so the `%i` identifier placeholder used in `$wpdb->prepare()` is supported on the declared floor, clearing Plugin Check `UnsupportedIdentifierPlaceholder` errors before publishing.

## 1.3.1

## 1.3.0

### Minor Changes

-   7f6ab85: Add Connected Sites for cross-site transaction data sharing: a data-sharing API exposing transactions to authorised sites, a consumer side that pulls from connected sites, and a Mollie settlement CSV import. Transaction import now lets you choose a connected-site or file source.
-   7682a28: Add a setting to disable bank-transfer payment close to the event date.
-   7f6ab85: Overhaul reconciliation splitting and allocations: auto-split a matched entry into one child per transaction, allow negative and adjustment allocations, store allocation amounts with their original sign, allow nonzero amounts when editing a split, tick the transaction on automatic matching, and add a bulk "Load Missing Mollie Fees" action to the transactions list.
-   7f6ab85: Send Telegram notifications for successful transactions, with test-mode payments clearly marked.
-   7f6ab85: Enrich transaction export: include the event URL as `detail_url`, carry the source `event_date_id`, and rename the entry "event" label to "link" so it is inherited on match.

### Patch Changes

-   7f6ab85: Miscellaneous fixes: link to the event page from the admin calendar, close the payment callback popup without a page reload, integrate the confirm & save buttons in the edit popup, keep a cancelled signup registered as "interested", remove the email from the purchase message, and stop nulling transactions.
-   7f6ab85: Update the local Docker environment and "Tested up to" headers to WordPress 7.

## 1.2.0

### Minor Changes

-   d04f565: Transaction reconciliation improvements. Import Mollie transaction reports, display links from transactions to budget entries, link payments to participants via typeahead with an option to update missing participants, and limit reconciliation to live (production) mode.
-   41a295c: Add payment error logging. New `PaymentLog` model with database schema, REST endpoint, and admin log viewer on the transaction page. Mollie webhook and payment endpoints record errors for troubleshooting.

## 1.1.1

### Patch Changes

-   c8a6a54: Improve the mobile UI for transactions.

## 1.1.0

## 0.2.0

### Minor Changes

-   3abfc47: Add application fee to transactions.
-   457cd90: Show transation result when open call payment callback.
-   e61b58c: Add advanced settings view, to simplify troubleshooting

### Patch Changes

-   a25d6c7: Move Mollie payment integration to OAuth & Mollie Connect.
