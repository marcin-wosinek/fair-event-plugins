=== Fair Audience ===
Contributors: marcinwosinek
Tags: events, participants, audience, management
Requires at least: 6.7
Tested up to: 7.0
Stable tag: 1.11.0
Requires PHP: 8.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Manage event participants with custom profiles and many-to-many event relationships.

== Description ==

Fair Audience is a WordPress plugin that helps you manage event participants. It provides:

* Custom participant profiles with name, surname, email, Instagram handle
* Email preferences (minimal or in-the-loop)
* Many-to-many relationships between participants and events
* Participant interest levels (interested or signed up)
* Admin interface for managing participants and viewing them by event
* REST API for integration with other tools

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-audience` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress
3. Use the Fair Audience menu in the admin panel to manage participants

== Frequently Asked Questions ==

= What WordPress version do I need? =

WordPress 6.7 or higher.

= Does this work with custom event types? =

Yes, it integrates with the fair_event post type from the Fair Events plugin.

== Changelog ==

## 1.11.0

### Minor Changes

-   a7c09e1: Time out unconfirmed marketing subscriptions after a week (reverting them to minimal+confirmed and sweeping expired confirmation tokens), let subscribers opt out of just the weekly events summary independently of their other topic preferences, and show that weekly-summary opt-out on the participant detail page. Show the link source (domain or @handle) next to off-site event links in the weekly digest. Route every outgoing email through a single consent-enforcing method so marketing-consent checks can no longer be skipped by a new send path, sanitize payment gateway errors before they reach the event-signup form, and drop the redundant event_participants.transaction_id column in favor of the transaction ledger. Remove the Add-on collaborator discount ticket option and standardize remaining block buttons on core Button styles.

### Patch Changes

-   Updated dependencies [a7c09e1]
    -   fair-events-shared@0.4.0

## 1.10.0

### Minor Changes

-   6973be8: Add a signup hook contract shared with fair-events, resolve payment webhooks via the transaction ledger, and support simple HTML in the weekly digest intro/outro text. Require confirmed status for the marketing email consent gate, fix the weekly digest to stamp its last-sent-week when the send slot already passed, and use the date param for the event-signup occurrence picker.

## 1.9.0

### Minor Changes

-   efe9aae: Move the fees, polls, instagram, collaborators, image-templates, timeline, import, and weekly-schedule bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags. None of these bundles had callers outside fair-audience, so this is the lowest-risk slice of the fair-audience/fair-audience-experimental split (issue #1041). The `fair-audience` top-level admin menu now lands on All Participants instead of the (now-moved) Activity Timeline page.
-   3e34be8: Move the groups and invitations bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `Group`/`GroupParticipant` and their repositories are renamed to `FairAudienceExperimental\…` and now travel with the companion; every core `fair-audience` call site (participant lists, custom mail, payment discount labels, signup pricing, anonymization, the signups-list block) and the `fair-events-experimental` invitation-token controller degrade gracefully via `class_exists()` guards when the companion is inactive.
-   e84e6b3: Move the galleries and messaging bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `PhotoParticipant`/`GalleryAccessKey` and `CustomMailMessage`/`ExtraMessage`/`ScheduledMessage` (plus their repositories, controllers, admin pages, media-library hooks, and the scheduled-message cron) are renamed to `FairAudienceExperimental\…` and now travel with the companion; every cross-plugin call site (`fair-events-experimental`'s gallery endpoint, stable `fair-events`' gallery page, `fair-form`'s questionnaire photo tagging, and core `fair-audience`'s email service and anonymization service) degrades gracefully via `class_exists()` guards when the companion is inactive.
-   8a1195f: Move the manage-event tab extensions (Audience, Groups, Mailings) out of `fair-audience` into the `fair-audience-experimental` companion under the `manage-event-ext` feature flag (issue #1041). The tab bundle's enqueue wiring on fair-events' manage-event page — previously always registered by `fair-audience` — now lives in the companion and only mounts when its `manage-event-ext` feature is enabled, mirroring how `fair-events-experimental` merges its own manage-event extensions.
-   612b9b0: Add a `GET /participants/stats` endpoint and a row of clickable stat tiles (total, mailing, pending, declined) above the All Participants table, so audience size and mailing health are visible without manually combining filters (issue #1054).
-   2a3600a: Move the manage-event Audience tab from `fair-audience-experimental` back into core `fair-audience`, so it now renders on the fair-events Manage Event page without the experimental companion plugin active. The Groups and Mailings tabs remain in `fair-audience-experimental` behind the `manage-event-ext` feature flag.
-   612b9b0: Add a Move action on the Manage Event Audience tab to re-point a participant's signup to a sibling occurrence of a recurring event in one step, instead of deleting and re-adding and losing attendance state, admin comments, ticket options, and payment status (issue #954). Adds `GET /event-dates/{id}/siblings` to fair-events and `POST .../participants/{id}/move` to fair-audience.
-   845f26f: Resume anonymous event signups on a recognised email instead of discarding the filled-in form: a visitor who types a known email with no matching session now gets an email that restores their ticket, activity, sliding-scale and questionnaire answers and takes them straight to payment or completion.
-   b40157e: Add the Weekly Digest admin page: configure the enable toggle, event source, send day/time, week scope, skip-empty, subject, and intro text, with a live preview pane, send-test-to-me button, and a last-run summary.
-   2bd2187: Add the weekly events digest backend: a `fair_audience_weekly_digest` option, `WeeklyDigestController` REST routes (config, sources, preview, test-send), a shared `WeeklyDigestRenderer`, and a `WeeklyDigestHooks` cron with `last_sent_week` idempotency (issue #916). No admin UI yet — configuration is REST-only until the admin page lands.

### Patch Changes

-   612b9b0: Replace `window.confirm`/`alert` on the All Participants page with a state-controlled ConfirmDialog naming the participant or count, a reusable EmailSendResultNotice for resend results, and Snackbar/Notice feedback for copy-link, per UI_GUIDELINES.md (issue #1056).
-   f1985d8: Add e2e coverage for the fair-audience-experimental Features registry (all-bundles-on/off admin page and REST route checks) and wire `dist-archive:fair-audience-experimental` into the root release build, closing out the fair-audience/fair-audience-experimental split (issue #1041).
-   612b9b0: Preserve scroll position when switching the recurrence occurrence picker on the event-signup block, which previously reset to the top of the page on the `?event_date=<id>` reload.
-   b007d8a: Centralize ticket price resolution in a new `FairEvents\Services\TicketPricing` service and a shared `ticket-pricing.js` module, so the fair-events get-tickets purchase paths and the fair-audience event-signup pricing agree on price. Previously get-tickets used a closed `[sale_start, sale_end]` sale-period interval while fair-audience used a half-open `[sale_start, sale_end)` interval with a `continues_pricing_period` fallback — the two could charge different prices for the same ticket type on a sale period's end day. get-tickets now uses the half-open convention too.
-   a7f7373: Fix "Cancel and start over" leaving the participant's `pending_payment` row in place, which let render.php's DB-fallback resurrect the same stuck checkout on the next page load. The delete event-signup endpoint now accepts `pending_payment` (not just `signed_up`), and the frontend calls it before navigating to the stripped URL.
-   f92bab0: Disable the Tickets, Signups, Finance, Groups, Audience, Mailings, and Statistics tabs on the Manage Event page when the event's link type is External URL, since there is no registration behind those tabs for link-only events.
-   612b9b0: Fix the consent checkbox block being registered but not insertable: add it to the allowed-blocks lists of fair-form, fair-form-conditional, and fair-audience's event-signup block.
-   91ca56d: Fix `create_multi_instance_signup()` paid response missing `success: true`, which left the buyer stranded on the event page instead of redirecting to checkout for `multiple_instances` ticket types.
-   91ca56d: Fix `register_and_signup()` (the public "I'm new" registration form) charging only one occurrence's price for `multiple_instances` ticket types instead of the sum across every chosen occurrence.
-   a7f7373: Fix stale `fair-audience-submission-detail` links in the participant timeline and participant detail page — the submission detail page moved to `fair-form`, so these now point at `fair-form-submission-detail`.
-   612b9b0: Move Add Participant to the native page-title-action position, drop the mostly-empty Phone/Instagram columns from the default All Participants view (still available via view options), and replace the Status + Email Profile columns with a single Mailing column that names the mailing intention (issue #1055).
-   612b9b0: Fix the "continue where you left off" email link landing on the failed-payment retry card instead of the resume form when the participant also had a stale `pending_payment` hold. The resume-token branch is now checked first, and the signup block auto-scrolls into view on restore.
-   a7f7373: Remove the seats-per-ticket capacity weighting feature. It let a ticket type consume more than one capacity slot, forcing every capacity query, signup projection, and participant snapshot to carry a per-row seat weight. Capacity math now collapses back to a plain row count; the Seats column/checkbox, the `seats_per_ticket` column, and the `seats` column on `event_participant` are dropped, with a forward migration for existing installs.
-   f4c06ef: Restyle the All Participants page with native WordPress components: stat tiles sit in an equal-width responsive grid with hover feedback and an accent highlight on the tile matching the active filter (aria-pressed), the tiles/notices/table share consistent VStack spacing, the events popover uses ItemGroup, and the page's inline styles move to a `style.css` built to `style-index.css` (AdminHooks now enqueues per-page stylesheets when present).
-   547ed04: Show a paid/pending/failed status marker next to the transaction link in the participant detail Events table, so an admin can tell a successful payment from a failed or abandoned one without opening each transaction.
-   1cdf0b4: Add test coverage for the weekly events digest (issue #916): PHPUnit tests for `WeeklyDigestRenderer` (config sanitizing, HTML shaping) and `WeeklyDigestHooks` (due/idempotency guard), a REST API spec for `WeeklyDigestController`, and a component test for the Weekly Digest admin page. Also adds a PHPUnit setup (`phpunit.xml`, `__tests__/bootstrap.php`) to fair-audience, mirroring fair-events.
-   Updated dependencies [b007d8a]
-   Updated dependencies [612b9b0]
-   Updated dependencies [612b9b0]
    -   fair-events-shared@0.3.0

## 1.8.0

### Minor Changes

-   551e827: Add three-level email consent (Yes / missing / No): new `declined` profile value records that a participant was asked and refused, a renamed `marketing-consent` endpoint handles both upgrade and decline in one request, and the event-floor consent modal lets organizers record Yes/No per row. All-participants table, edit modal, and participant detail now display the declined state.
-   2cb0fb8: Move the Audience, Groups, and Mailings tabs out of fair-events and into fair-audience, which now owns audience-facing management for an event. fair-events registers the extension point and fair-audience renders these tabs, consolidating participant and mailing management in one plugin.
-   8a3310c: Allow upgrading an existing single-instance signup to a whole-series pass instead of blocking it as a duplicate. The buyer is charged only the difference between the series price and what they already paid, and every transaction on a registration is now preserved in a ledger (laying the groundwork for refunds).
-   2cb0fb8: Add sliding-scale (pay-what-you-can) event pricing: organizers can offer a ticket type where the buyer chooses the amount within a configured range. The manage-event admin UI exposes the new pricing mode, the event-signup block lets attendees enter their own price, and the server validates the chosen amount against the configured bounds.
-   2cb0fb8: Show test-mode ticket sales in the participant timeline while the site is in test mode, so organizers verifying a checkout flow can see the resulting sale events. Test-mode sales are hidden again when test mode is off.

### Patch Changes

-   2cb0fb8: Bump @wordpress/components 35→36 and @wordpress/dataviews 16→17. The DataViews upgrade can change table rendering in the admin views that use it, so the shipped bundles for these plugins are regenerated.
-   2cb0fb8: Add recurrence scope for ticket types on recurring events: a ticket type can apply to a single occurrence or to `multiple_instances`. A scope-choice modal prompts the organizer when editing ticket types on a recurring event, the Ticket Prices table shows the active scope in parentheses, and sold ticket types are locked against scope changes. The event-signup block respects the resolved scope when listing available tickets.
-   7e594d7: Add manual disable/enable for sold ticket types: a new `disabled` boolean column on ticket types lets admins hide a type from the signup form without deleting it. The admin UI replaces the Remove button with an Enable/Disable toggle when the type has sales. The server guards against deleting sold types omitted from the payload (defense in depth). The event-signup block and the GetTickets gate both respect the flag.
-   Updated dependencies [2cb0fb8]
    -   fair-events-shared@0.2.0

## 1.7.0

### Minor Changes

-   c60efeb: Block paid-event signup when the payment connector is not configured. Previously `maybe_start_paid_signup()` and `maybe_start_addon_payment()` fell through to the free path whenever the resolved total reached zero — which happened when the EventSignupPricing service was unavailable or unconfigured, silently granting free access to paid events.

    Adds `TransactionAPI::is_configured()` (delegating to `MolliePaymentHandler::is_configured()`) and `EventSignupPricing::has_paid_price_configured()` so both conditions are checked before allowing a zero-total signup to proceed.

-   c60efeb: Highlight the recognized participant's name in the signup block greeting by wrapping it in a bold, blue `<strong>` element, so users with a participant token clearly see the system has identified them.
-   44dd064: Move form answer admin pages (Form Answers, Questionnaire Responses, Submission Detail) from fair-audience into fair-form. The pages now appear under a new Fair Form admin menu. Cross-plugin links to fair-audience (participant detail, by-event back-link, event picker) are preserved as soft dependencies pending Phase 2.

### Patch Changes

-   8570634: Fix signups-list block always showing count-only view for token-bearing participants with group view_signups permission (stale GroupPermissionRule namespace after move to fair-events-experimental).
-   5043462: Move fair-form blocks and questionnaire data layer from fair-audience into fair-form. Block names (fair-audience/fair-form*) and table names (fair*audience_questionnaire\*\*) are unchanged for backward compatibility. fair-audience degrades gracefully when fair-form is absent via class_exists guards.

## 1.6.0

### Minor Changes

-   4363b40: Add an opt-in "Powered by Fair Event Plugins" attribution. A single toggle in the fair-events General settings (off by default) renders a subtle, translatable line under the fair-audience signup blocks and at the bottom of participant emails.

### Patch Changes

-   fb3165c: Add a site-wide default currency setting. Admins can now choose the currency (EUR, USD, GBP, CHF, DKK, NOK, SEK, PLN, CZK, HUF) in Fair Payments Connector → Settings → Currency; all new transactions, fees, and price displays across the plugins inherit this setting instead of being hard-coded to EUR.

## 1.5.0

### Minor Changes

-   76c23f7: Upgrade @wordpress/dataviews from v4 to v16 for admin list views.

## 1.4.0

### Minor Changes

-   d0daed8: Show group discount note on event-signup block

## 1.3.4

### Patch Changes

-   02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
    `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
    feature flag (resolved through the same constant / master / filter / option /
    default chain as the existing Fair Events features). The flag is exposed in
    each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 1.3.3

### Patch Changes

-   0ebaea4: Group admin menus with string positions to avoid overwriting core menus

    Each plugin's top-level admin menu now registers with a unique string decimal
    position (`20.1`–`20.4`) so the four menus cluster together in order without
    colliding with each other or with core WordPress menu items.

## 1.3.2

## 1.3.1

## 1.3.0

### Minor Changes

-   7f6ab85: Let signed-up users add activities to their existing subscription: once signed up they see a registration view instead of the signup form, with the full activity list kept visible (already-booked ones shown disabled).
-   7f6ab85: Add an anonymous event-interest signup block, styled to match the event-signup block and pre-filled from a known identity when available.
-   6b8f010: Add scheduled per-event mailings: queue an email anchored to an event date's start/end with a signed offset, sent automatically by a recurring cron, managed from a new "Mailings" tab in the event admin.
-   7f6ab85: Send a mailing-list confirmation email for paid event signups, with an admin action to resend it for pending participants (single and bulk, surfaced in the selection footer). Signup confirmation emails are now deferred off the request path.
-   7682a28: Robust Mollie payment retry flow and signup identity handling. Resume links in payment-failure emails, a "Continue payment" UI for open Mollie status, recovery after cookie expiry, and preserved ticket selection across retries. Signup identity now prefers the logged-in WP user over the session cookie, with a 1-hour pre-fill cookie and a "start fresh" escape hatch. Ticket quantity limits are enforced.
-   7f6ab85: Make per-period activity pricing a global setting; activity option prices are derived from the active sale period.
-   3f8fdb4: Add an optional per-ticket-type minimum activities requirement that can raise the event-date-wide minimum (e.g. an "Early bird" ticket requiring at least 2 activities). The per-type value only ever increases the requirement; a value below the global minimum is ignored. Enforced both in the signup form (the gate updates live as the buyer switches ticket type) and server-side.
-   7f6ab85: Export questionnaire responses to Markdown, sharing one submission-markdown template between the submission detail and responses pages. Phone answers now persist in questionnaire submissions.
-   7682a28: Recurring events and sign-up management. Sign up for recurring events with synced date pickers, master-group inheritance, and orphan cleanup. New printable sign-up lists with comments, capacity limits, and in-popup role editing. Ticket settings reorganized with sales periods moved out of the ticket table. Finance tab filters failed/live transactions and deep-links to transactions and participants. Group invitations added.
-   7f6ab85: Record verbal marketing consent directly from the Audience tab.

### Patch Changes

-   7f6ab85: Miscellaneous fixes: link to the event page from the admin calendar, close the payment callback popup without a page reload, integrate the confirm & save buttons in the edit popup, keep a cancelled signup registered as "interested", remove the email from the purchase message, and stop nulling transactions.
-   ca7cc51: Include the attendee's custom signup question answers in the signup confirmation email (free and paid signups). File-upload answers render as a link to the attachment; multiselect answers render as a readable list. Answer formatting is shared with the form-confirmation and form-notification emails.
-   c41b5bc: Use ticket option short names in Telegram sale notifications. Falls back to the full name and then to the snapshot name when no short name is set, so existing configurations keep working unchanged.
-   7f6ab85: Update the local Docker environment and "Tested up to" headers to WordPress 7.

## 1.2.0

### Minor Changes

-   41a295c: Improve event audience management. Edit ticket type and options on existing sign-ups via a popup, delete sign-ups, and store the chosen option name on the sign-up record. Audience table gains copy buttons, activity totals, side counter, ticket shortname, and a wider layout that shows the activity options purchased by each participant.
-   41a295c: Improve participant management. Add a link to edit a user's mailing settings, and a remove-user button that anonymizes the participant across groups, poll access keys, and poll responses.
-   41a295c: Update the sign-up confirmation email and apply discount logic across activities and ticket options at sign-up time.
-   41a295c: Link tickets to event activities. Tickets can now be assigned to specific activities by ID, with per-activity discounts (including facilitator-based discounts) applied at sign-up and at the option level. Ticket option table extended to support this.

### Patch Changes

-   41a295c: Fix missing link from membership payment to participant.
-   41a295c: Fix free ticket error, ticket break in the editor, and price setting error.
-   41a295c: Activity log improvements. Combine multiple user sign-ups into a single timeline entry, add event sign-up entries, and hide test payments from the activity log.

## 1.1.1

### Patch Changes

-   e22779c: Add email notification to form sign up & registrations
-   c8a6a54: Add participant's import form kit.com

## 1.1.0

### Minor Changes

-   2708bf8: Add foto author to the image.

## 0.2.0

### Minor Changes

-   109ae1a: Add participant poll feature.
-   fe6b0c8: Add import from Entradium xlsx.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-09

### Added

-   Initial release
-   Participant management with name, surname, email, Instagram handle
-   Email preference settings (minimal or in-the-loop)
-   Many-to-many relationships between participants and events
-   Participant labels (interested or signed up)
-   Admin interface for managing participants
-   Events list with participant counts
-   Event participants view
-   REST API endpoints for participants and event-participant relationships
-   Database tables for participants and event-participant relationships

[0.1.0]: https://github.com/marcin-wosinek/fair-event-plugins/releases/tag/fair-audience-0.1.0

== Upgrade Notice ==

= 0.1.0 =
Initial release
