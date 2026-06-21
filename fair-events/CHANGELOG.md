# fair-events

## 1.6.0

### Minor Changes

-   f46e6ec: Add events-week block with a copy-summary button (includes page URL in the header) and a global start-of-week plugin setting. The weekly-schedule block it replaces has been removed.
-   4363b40: Add an opt-in "Powered by Fair Event Plugins" attribution. A single toggle in the fair-events General settings (off by default) renders a subtle, translatable line under the fair-audience signup blocks and at the bottom of participant emails.
-   fb3165c: Add a site-wide default currency setting. Admins can now choose the currency (EUR, USD, GBP, CHF, DKK, NOK, SEK, PLN, CZK, HUF) in Fair Payments Connector → Settings → Currency; all new transactions, fees, and price displays across the plugins inherit this setting instead of being hard-coded to EUR.

### Patch Changes

-   f46e6ec: Fix calendar overflow, disable pointer events on links and buttons inside calendar/events blocks in the editor (prevents accidental navigation), and guard Venue lookup in event-info block render. Include participant email in the delete-participant confirmation dialog.

## 1.5.0

### Minor Changes

-   82e6f21: Move Venue model and VenueController from fair-events to fair-events-experimental. The venues REST API (`/fair-events/v1/venues`) is now registered by the experimental plugin under its `venues` feature flag.
-   76c23f7: Upgrade @wordpress/dataviews from v4 to v16 for admin list views.

### Patch Changes

-   ead4d69: Move Duplicate Event, Merge Event, and Mailings tab to fair-events-experimental; rename linking option "No link (standalone event)" to "Event placeholder"; fix Finance tab gating behind fair-finance plugin

## 1.4.1

### Patch Changes

-   3d0e399: Fix npm dependencies

## 1.4.0

### Minor Changes

-   d0daed8: Add optional per-ticket-type end date (disable_at) and fix undefined variable in event update

## 1.3.4

### Patch Changes

-   02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
    `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
    feature flag (resolved through the same constant / master / filter / option /
    default chain as the existing Fair Events features). The flag is exposed in
    each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 1.3.3

### Patch Changes

-   9ffc5a8: Calendar: link each recurring instance to its own date

    Per-occurrence URLs now include `?event_date={id}` in the events-calendar block,
    the weekly-schedule block, and the public events REST API, so visitors land on
    the specific instance rather than the bare event permalink. The admin calendar
    distinguishes generated recurring instances visually (own icon and color) instead
    of styling them like unlinked events.

-   0ebaea4: Group admin menus with string positions to avoid overwriting core menus

    Each plugin's top-level admin menu now registers with a unique string decimal
    position (`20.1`–`20.4`) so the four menus cluster together in order without
    colliding with each other or with core WordPress menu items.

## 1.3.2

## 1.3.1

### Patch Changes

-   518b6eb: Fix release tooling: sync plugin header Version with package.json so SVN tag publishing finds the dist archive

## 1.3.0

### Minor Changes

-   7f6ab85: Show net amounts in the event finance tab: net received per payment, plus a "Total Net" summary tile.
-   6b8f010: Add scheduled per-event mailings: queue an email anchored to an event date's start/end with a signed offset, sent automatically by a recurring cron, managed from a new "Mailings" tab in the event admin.
-   2ed7435: Introduce a feature-flag registry (`FairEvents\Core\Features`) that splits the
    plugin into bundles — `venues`, `sources`, `galleries`, `ticketing`,
    `event-tools`, `migration` — defaulting **off** for a clean public install.
    Define `FAIR_EVENTS_INTERNAL` (or a per-bundle `FAIR_EVENTS_FEATURE_*`
    constant) in `wp-config.php` to opt back into the full build; otherwise toggle
    bundles from the new **Settings → Features** tab. REST controllers, admin
    pages, blocks, frontend rewrites, and manage-event tabs all consult the
    registry, so disabled bundles register no routes and surface no UI.
-   7f6ab85: Enhance the participant list printout with row numbers, role and ticket-type columns, and a mailing-list column pre-checked for consented participants.
-   7f6ab85: Make per-period activity pricing a global setting; activity option prices are derived from the active sale period.
-   3f8fdb4: Add an optional per-ticket-type minimum activities requirement that can raise the event-date-wide minimum (e.g. an "Early bird" ticket requiring at least 2 activities). The per-type value only ever increases the requirement; a value below the global minimum is ignored. Enforced both in the signup form (the gate updates live as the buyer switches ticket type) and server-side.
-   7f6ab85: Export questionnaire responses to Markdown, sharing one submission-markdown template between the submission detail and responses pages. Phone answers now persist in questionnaire submissions.
-   7682a28: Recurring events and sign-up management. Sign up for recurring events with synced date pickers, master-group inheritance, and orphan cleanup. New printable sign-up lists with comments, capacity limits, and in-popup role editing. Ticket settings reorganized with sales periods moved out of the ticket table. Finance tab filters failed/live transactions and deep-links to transactions and participants. Group invitations added.

### Patch Changes

-   461b792: Stack the activity option Name and Short name inputs in a single column (one above the other) instead of two side-by-side columns, narrowing the activity options table.
-   0a4fe6c: Fit the Event meta box action buttons into the available sidebar width: "Edit Full Details" and "Unlink from event" now share one row beneath the full-width "Save Event" button, so longer translated labels no longer wrap awkwardly.
-   6f50483: Fix `payment_expires_at` being parsed as local time in the Manage Event audience tab, which falsely flagged in-progress payment holds as expired on non-UTC browsers (e.g. CEST).
-   be4ad94: Hide the per-ticket-type "Min. activities" field behind a new "Per-ticket-type minimum activities" setting in the ticket Configuración panel (off by default). When the setting is off, every ticket type uses the event-wide minimum; turning it on reveals the per-type input, which still only ever raises the global.
-   fa588db: Reorganize the Manage Event "Event details" tab into stacked full-width cards (Basics, Categorization, Recurrence) so it uses the available desktop width like the Audience tab.
-   7f6ab85: Miscellaneous fixes: link to the event page from the admin calendar, close the payment callback popup without a page reload, integrate the confirm & save buttons in the edit popup, keep a cancelled signup registered as "interested", remove the email from the purchase message, and stop nulling transactions.
-   7f6ab85: Update the local Docker environment and "Tested up to" headers to WordPress 7.

## 1.2.0

### Minor Changes

-   41a295c: Improve event audience management. Edit ticket type and options on existing sign-ups via a popup, delete sign-ups, and store the chosen option name on the sign-up record. Audience table gains copy buttons, activity totals, side counter, ticket shortname, and a wider layout that shows the activity options purchased by each participant.
-   41a295c: Link tickets to event activities. Tickets can now be assigned to specific activities by ID, with per-activity discounts (including facilitator-based discounts) applied at sign-up and at the option level. Ticket option table extended to support this.

### Patch Changes

-   41a295c: Fix free ticket error, ticket break in the editor, and price setting error.

## 1.1.1

### Patch Changes

-   e22779c: Add email notification to form sign up & registrations

## 1.1.0

### Minor Changes

-   51b63e5: Add photo taxonomy by events.
-   e09b50a: Add option to link the event images.

### Patch Changes

-   04c4196: Add migration workflow for events.

## 0.7.0

### Minor Changes

-   cf7f5de: Add weekly schedule block.
-   27ff8bd: Add event sources & iCal feed.

### Patch Changes

-   c806c7c: Add iCal for calendar display.

## 0.6.1

### Patch Changes

-   eeaccd0: Add option to show draft events on a calendar.

## 0.6.0

### Minor Changes

-   96a150c: Add calendar display block.

## 0.5.2

### Patch Changes

-   fa15b85: Improve copy screen for events.

## 0.5.1

### Patch Changes

-   7e7ea9c: Update version tested up to version to 6.9.

## 0.5.0

### Minor Changes

-   83743d6: Add a workflow to copy the event

### Patch Changes

-   3a60309: Add lenght dropdown to the event content type.
-   97fd67d: Add support for user groups.

## 0.4.3

### Patch Changes

-   9b83592: Link to RSVP confirmation if plugin is available

## 0.4.2

### Patch Changes

-   ccb5d6a: Add list of upcomming events

## 0.4.1

### Patch Changes

-   2ee1396: Integrate event & schedule blocks—reference event dates in block
-   1bfddd0: Fix data formating in translated date

## 0.4.0

### Minor Changes

-   8f0db61: Move start & end dates to separate table

## 0.3.3

### Patch Changes

-   4ed3721: Add location to fair-events
-   ee8bef8: Simplify showing the dates in event-dates block
-   2e270f0: Add translations for PL, DE & ES

## 0.3.2

### Patch Changes

-   8c3c2fe: Fix the category search in event-list block
-   46fbaaf: Fix the filtering in event-list block

## 0.3.1

### Patch Changes

-   c8f06d5: Fix slug setting page

## 0.3.0

### Minor Changes

-   Add slug setting
-   Improve edit UX

## 0.2.0

### Minor Changes

-   f39c6fb: Add list view block with patterns support
