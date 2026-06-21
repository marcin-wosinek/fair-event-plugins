=== Fair Audience ===
Contributors: marcinwosinek
Tags: events, participants, audience, management
Requires at least: 6.7
Tested up to: 7.0
Stable tag: 1.6.0
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
