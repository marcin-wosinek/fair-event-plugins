# fair-events

## 1.16.0

### Minor Changes

-   faf5f85: Show the active sale period beside ticket prices when an event has multiple pricing periods.
-   04cce70: Add per-ticket extension selection controls with authoritative minimum and maximum enforcement in the signup interface and API.

### Patch Changes

-   f12c183: Repair malformed recurring event dates so active occurrences return to admin and public calendars.
-   14dd888: Interpret mailing consent as opted in only when the signup explicitly records consent.
-   bca9fd4: Combine multi-day events into one ranged line in copied weekly summaries.
-   41cdb3c: Replace registered attendees' recurring-date link lists with compact selectors that navigate to the correct public occurrence.
-   d3f3bee: Make the basic event Copy flow available without Fair Events Experimental while keeping advanced Duplicate and Merge tools experimental.
-   f45f69a: Keep the event signup cancellation button legible in every interaction state.
-   cd96441: Let cookie-recognized visitors safely forget the remembered identity from an existing signup without cancelling it.
-   47b9041: Persist and enforce audience-group ticket restrictions without requiring Fair Events Experimental.

## 1.15.0

### Minor Changes

-   6f47529: Navigate calendar months and weeks in place while preserving bookmarkable URLs, browser history, accessibility feedback, and no-JavaScript fallback links.
-   7133cd9: Add an admin action to permanently delete an individual local signup without affecting related signups or payment-provider transactions.

### Patch Changes

-   70445e4: Include the validated ticket buyer email in Mollie metadata while omitting unresolved participant and local user identifiers.
-   fd97ee2: Synchronize event post links across Polylang translation groups.
-   121db5a: Keep paid signup holds active for their full duration regardless of the WordPress site timezone.
-   3366b0b: Recover missing event details in the new-event editor without requiring a save or reload.
-   0c2aaad: Retain expired paid signups for reconciliation, safely process late payment notifications, and scrub retained signup details during participant anonymization.
-   5ce3559: Hide disabled and out-of-window ticket types from event signup.
-   2a0e856: Add HTML anchor support to the Event Signup block.
-   8d83293: Ticket purchase transaction descriptions now use the event's name (e.g. "Ticket for Dance connection") instead of its raw numeric ID (e.g. "Ticket for event #43"), matching the format other transaction types already use. Applies to both single-occurrence and recurring/multi-instance signups; falls back to the previous numeric format for event dates with no linked post. Existing transactions are unaffected.

## 1.14.0

### Minor Changes

-   049bf89: Give the events-calendar and events-week blocks' month/week views their own canonical URLs when requested within a bounded window (±3 months / ±12 weeks of today), so individual month/week pages can be indexed separately instead of collapsing into the default page's canonical.
-   990ff3e: Add a Venues admin page and REST API, promoted from Fair Events Experimental. Venues are now available by default — no experimental feature flag required — and the event edit screens show both a venue picker and a free-text address field.
-   8d9430e: Give each occurrence of a recurring event its own canonical URL (and matching Open Graph/JSON-LD `url`), so individual dates can be indexed separately instead of collapsing into one canonical page.

### Patch Changes

-   8e06c54: Fix calendar month view and week view resetting scroll position to the top of the page when clicking next/previous navigation.
-   6920161: Fix `GET /event-dates?event_id=<id>` returning every event date in the database instead of filtering by the given event.
-   d64b596: Fix linking/unlinking a page from a recurring event sometimes only applying to one date in the series instead of the whole series, by making the "which event is this page linked to" lookup always resolve through the series' primary date.
-   c40036a: Fix event structured data (JSON-LD) dropping all ticket offers when a sale period has no explicit end date, and add each offer's ticket option name so multiple tiers are distinguishable in rich results.
-   4d4aeae: Register activity option (ticket option) names and short names for Polylang string translation, so multilingual sites can translate them and have the translation appear on the public signup form.
-   840488b: On sites running Polylang, the Events Calendar and Events Week blocks now link each event to the translation of its linked page matching the calendar/week page's current language, falling back to the currently linked page when no matching translation exists.
-   bb63051: Fix the public events feed: a standalone external-link event with no explicit attendance mode now carries `location: { mode: 'online', joining_url: ... }` instead of omitting the `location` field entirely.
-   c8b1abf: Fix calendar and week view header wrapping letter-by-letter on mobile widths; the Previous/Next buttons now stay legible and stack full-width below the title on narrow screens.
-   6462cc8: Add spacing between the last custom question and the "Get Tickets" button in the event signup form, matching the gap used between other fields.

## 1.13.0

### Minor Changes

-   e0ea5a6: Add an explicit in-person/online/hybrid attendance mode with a joining link on the event date, replacing the old inference from the event's link type. Structured data (JSON-LD), calendar feeds, and the public event-info block now reflect the selected mode, and the mode/link are inherited by generated series occurrences like venue and address.
-   1a85cf6: Add "Show ticket price" and "Show option prices" toggles to the Event Signup block, so organizers can hide itemized pricing from the signup form when it's communicated elsewhere. When option prices are shown, they now consistently display as an addition to the base price (e.g. "+10.00€").
-   49f2e0a: Link the event name to its page in the confirmation-family emails — signup confirmation, payment-failed, activities-added, event-interest, and mailing-list-welcome — instead of just bolding it. Falls back to the previous bold-only text when no event URL is available.
-   aeda159: Send a payment-failed email (event name, plain link back to the event page) from the standalone Event Signup block when a payment fails, is rejected, cancelled, or expires — mirroring fair-audience's own failed-payment email so buyers on fair-audience-free sites get the same notice. The shared `SignupConfirmationEmail` formatter gains an optional plain action link, reused for this new email.
-   bab5a8a: Send a baseline signup confirmation email (event name, date, and registration reference) when fair-audience isn't active, so the "check your email" promise in the event-signup block is always fulfilled. The free-signup success message now mentions the confirmation email too, matching the paid path.
-   f64745d: Move fair-audience's signup confirmation email formatting into a shared `FairEventsShared\Notifications\SignupConfirmationEmail` formatter, and use it for both plugins' confirmation emails. fair-audience's confirmation email now also shows the event date, a registration reference, and the ticket type. fair-events' standalone confirmation email (sent when fair-audience isn't active) is now built from the same branded HTML template instead of a plain-text message, and includes the ticket type and — on paid signups — the amount paid.

### Patch Changes

-   4b9d893: Add "Date" and "Date & Time" question blocks (mirroring the email/phone/url questions) that render the browser's native date/date-time picker on the frontend. Values are validated server-side as real, well-formed dates and rejected with the same error conventions as other typed fields; datetime answers are stored as site-local time. Stored answers render as localized, human-readable dates in the submission-detail and questionnaire-responses admin views. Also adds the new question types to Event Signup's block inserter (fair-audience and fair-events) and their shared validation (fair-events-shared).
-   4ec1056: Add a URL question block (mirrors the email question) that renders a mobile-friendly text input on the frontend, normalizes bare domains to `https://`, and rejects non-web values server-side. Stored answers render as links in the submission-detail and questionnaire-responses admin views. Also fixes the url and email questions never appearing in the block inserter inside Event Signup (fair-audience and fair-events), and extracts the question-block allow-list into fair-events-shared so fair-form-conditional stays in sync.
-   5fa6fd6: Align nav bar spacing and "today" highlight styling between the events-calendar and events-week blocks, which had visually diverged.
-   5fe6658: Reduce the database queries issued when rendering or purchasing through the Event Signup form: the active sale period, the viewer's group memberships, and the event's discount rules are now resolved once per render/request and reused across every ticket tier and activity, instead of being re-resolved once per tier. Query count no longer scales with the number of ticket tiers; displayed and charged prices are unchanged.
-   0e27b5c: Fix the Event Signup form leaking one visitor's group-restricted ticket tiers, discounted prices, and name/email pre-fill to another visitor under full-page caching. The form now server-renders the same unrestricted, undiscounted, unfilled markup for every viewer, and fetches the actual viewer's personalization (restricted tiers, discounts, pre-fill, signed-up state) client-side after load.
-   3508d85: Require confirmation before clearing the organizer logo override, matching the confirmation pattern used for other destructive actions in the admin.
-   f62946d: Fix the ticket editor's "Save tickets" button and JSON import misfiring against a nonexistent event when the component is used in controlled mode (e.g. embedded in another plugin's wizard) instead of Manage Event's own self-load/self-save mode.
-   58e85f6: Add a "Header Background" color control to events-calendar and events-week, and rename events-calendar's ambiguous "Background"/"Text" color labels to "Event Background"/"Event Text" to match events-week.
-   1d9d738: Fix event-proposal and event-signup blocks to use the standard block wrapper markup, so their padding/margin sidebar controls now actually apply on the frontend.
-   c30daa6: Fix the event signup form's newsletter checkbox and custom question fields (short text, long text, select, radio, multiselect, consent) rendering unstyled — they now match the form's standard input styling and the newsletter checkbox drops to its own row instead of sitting inline with the quantity field.
-   0a116a2: Fix events-calendar/events-week block colors being silently ignored when the color picker returns a non-hex CSS value (e.g. `oklch(...)`, `rgb(...)`) instead of a preset slug or hex code — such values were wrongly treated as WordPress preset-color slugs, producing invalid CSS that browsers dropped.
-   c5c60b7: Fix the event Finance tab counting income twice when a bank-statement entry has been reconciliation-matched to a payment transaction: matched financial entries are now excluded from totals, so only the transaction's gross amount is counted.
-   64ffbf9: Fix the Event Signup block's "Choose a date" picker disappearing once a recurring series ages down to its last upcoming occurrence, leaving no confirmation of which date a per-occurrence ticket was signing up for.
-   09d5d55: Fix the Event Signup form listing ticket types with no pricing for the currently active sale period — they now stay out of the list entirely instead of showing unpriced and selectable. When no sale period is active at all, the ticket-type section is hidden and signup is treated as temporarily unavailable, matching the existing payments-unavailable treatment. The get-tickets purchase endpoint also now rejects an out-of-window ticket type with a 409 error instead of silently charging 0.
-   089a463: Allow an event page to be linked as a secondary alias of another event page, and allow adding another linked page to an event that already has one. Relinking a page cleanly detaches its own auto-created event date instead of the previous "already linked to another event" error.
-   b138421: Render the Previous/Next navigation links in events-calendar and events-week as standard `core/button` outline buttons, so they follow the active theme's button styling instead of hardcoded colors.
-   d51522b: Fix the event Finance tab double-counting income: Total Income now comes only from paid transactions instead of also adding fair-finance entries, which could duplicate the same money when an entry wasn't explicitly reconciliation-matched. The entries table is now cost-only, and the Payments table shows each transaction's linked budget entry (if any).
-   fc86b53: Show the ticket type name instead of its raw numeric ID in the Manage Event page's signups table and CSV export. A signup whose ticket type is missing or was later deleted now shows "—" instead of an ID or a blank field.
-   172880a: Hide the multi-period sale-periods calendar on the Tickets tab when Multiple pricing periods is off, so the single From/Until sale window isn't cluttered with chrome built for comparing several named periods.
-   7932bb2: Add an opt-in "read event details from the linked page" setting to the URL question, off by default. When enabled, the submitted address is looked up as soon as the visitor leaves the field, and any structured event data it publishes (schema.org markup, falling back to social-sharing metadata or the page title) is shown live in an info bubble beneath the field, marked as read from the page. Nothing is stored — an unreachable page, a non-HTML response, or a page with no usable data simply shows no bubble. The fetch/parse logic that powers this also moves into a shared `AbstractUrlLookupController` (fair-events-shared) that fair-events' own admin lookup now extends instead of duplicating.
-   Updated dependencies [4b9d893]
-   Updated dependencies [4ec1056]
-   Updated dependencies [49f2e0a]
-   Updated dependencies [aeda159]
-   Updated dependencies [f64745d]
-   Updated dependencies [7932bb2]
    -   fair-events-shared@0.6.0

## 1.12.0

### Minor Changes

-   3e696d0: Move the "Bundled translations" toggle out of each plugin's own settings screen into a single shared **Settings → Fair Event Plugins** screen that lists one row per active plugin. Previously saved values keep working unchanged. fair-audience and fair-payments-connector lose their Features tab (bundled-translations was its only entry); fair-timetable loses its whole Settings page; fair-platform loses its Features submenu. fair-events keeps its Features tab for the Ticketing bundle. The experimental companion plugins (fair-events-experimental, fair-audience-experimental, fair-payments-connector-experimental) now always load their bundled translation files instead of waiting on a WordPress.org language pack that will never exist for them.
-   8fa5d96: The unified Event Signup block (`fair-events/event-signup`) no longer delegates its render to fair-audience's legacy block when fair-audience is active — it renders its own markup unconditionally, and fair-audience enriches that same render via the existing filter/render-slot hooks instead of owning a competing template. A returning participant who already holds a ticket for the date now sees a signed-up/cancel card in place of the signup form, with a "cancel signup" action; per-occurrence date pickers label dates the viewer already holds (including via a whole-series pass); a resubmitted paid-ticket purchase for a date already held is rejected instead of silently creating a second charge; the per-IP rate limit is raised to 20/hour with an added 3/hour per-email limit, so a shared venue Wi-Fi no longer blocks legitimate signups. Sites without fair-audience see no change. The legacy `fair-audience/event-signup` block, its own identity routes, and existing signup links keep working unchanged for content authored before this change; participant_token URL login and the "I have an account" resume-by-email flow are not yet available on the unified form and remain on the legacy block for now.
-   9ae94d2: The unified Event Signup form (used when fair-audience is inactive) now shows a rich outcome when a visitor returns from paying: a confirmed card (event, amount, "confirmation email on its way"), a processing card that polls and updates in place, or a resume/retry card for a failed, canceled, expired, or abandoned payment — with buttons to continue the existing checkout, retry with a new one, or cancel and start over. A visitor who navigates directly back to the event page (no return link followed) now also sees their in-progress payment, recognised via a short-lived signed cookie, within the 15-minute hold window. Payment status is reconciled with the payment provider on return so the page never misreports a payment mid-redirect. When online payments are unavailable, ticket sales still show the existing "temporarily unavailable" notice instead of a dead retry button.
-   d5ca5fa: The unified Event Signup form (used once fair-audience owns the flow, #1245) now respects group-restricted ticket types and group discount pricing: a ticket type restricted to specific groups is rejected server-side for a visitor who isn't a member, and the charged price reflects the viewer's best-matching group discount, with a note shown above the submit button. Entitlement is resolved from the signed-in/known viewer's session, never from the submitted name/email, so a crafted request can't unlock a restricted tier or a discount it isn't entitled to.
-   c69501e: The Organizer settings tab now shows the site's actual name, logo, and website as live placeholders, with a clear way to override each per-field. Added an optional contact point (email/phone), emitted as a Schema.org `ContactPoint` on the sitewide Organization block. Blank fields keep today's behaviour (site name + home URL, theme logo), so existing sites see no change until an admin opts in.
-   1c4ac34: Removed the invitation-gated ticket signup mechanism: the "invitation only" ticket type toggle, the Manage Invitations admin page and its REST routes, and the public signup form's `?invitation=` link handling and "show inviter's name" option. The gating check had silently broken (an autoloader namespace mismatch made it dead code — invitation-only ticket types were already invisible on the public form, not merely restricted), so a migration disables any ticket type that was previously marked invitation-only rather than making it suddenly public, and drops the now-unused `invitation_only` column and `fair_events_invitation_tokens` table. Group-restricted ticket types and the separate bulk "send invite emails" outreach feature are unaffected.
-   ab61aba: Fixed a PHP 8.2 dynamic-property deprecation notice that fired on nearly every event-date read (`EventDates::$signup_price`, left over from a partially-reverted merge). Rather than re-declaring the field, finished removing it: the flat per-date "simple pricing" mode and pay-what-you-can sliding scale it powered were already superseded by ticket-type pricing everywhere except the legacy fair-audience Event Signup block, which now prices signups from ticket types only. The `signup_price` column is dropped from the event dates table via migration. Also fixed the same class of deprecation notice on `FairAudienceExperimental\Models\Group::$member_count`, populated by the groups admin list.
-   8f1871d: The unified Event Signup form (used once fair-audience owns the flow, #1245) now supports selectable activities (ticket options): a participant can pick zero or more paid or free add-on activities at signup, subject to a minimum-activities requirement (global or raised by the selected ticket type), and a signed-up participant can add further activities to an existing registration. Capacity, pricing, and group discounts are all enforced server-side, so a crafted request can't buy a full activity, skip the minimum, or dodge the charge.

### Patch Changes

-   7281a45: Centralize amount and currency formatting behind a shared `FairEventsShared\Money` helper (PHP) and matching `formatMoney`/`formatMoneyInline` helpers (JS), fixing the Fair Audience and Fair Events signup blocks, which previously hardcoded the € symbol regardless of the site's configured currency. A non-EUR site (e.g. PLN, CZK, HUF) now shows its real currency on ticket labels, add-on prices, and the running total — including after ticking an option, which previously reverted to €. EUR output is unchanged everywhere (signup blocks, emails, Timeline, Mollie payloads).
-   84cfda0: The Conditional Section block, when nested inside a signup form, can now show or hide its contents based on the visitor's selected ticket type (in addition to the existing question and event-option sources) — pick one or more ticket types and an "is selected" / "is not selected" operator, and the section reacts live as the visitor changes their selection. Also fixes the Conditional Section's "Event option" condition source, which failed to appear when nested inside the unified Event Signup block (it only recognized the older, hidden legacy block).
-   e1accb0: Fix iCal feed import storing the wrong time of day for timed events whose source timezone differs from the site timezone (`DateHelper::datetime_to_local()` never converted, since Sabre's iCal parser returns `DateTimeImmutable`, not `DateTime`). Also fix floating/all-day iCal values being interpreted through UTC instead of directly as site-local, which could shift an all-day event's civil date by a day on negative-offset site timezones.
-   e17ff5b: Fix the Event Signup block's "Form content" area being unclickable in the block editor (the add-block appender, and any already-nested question blocks, inherited the live preview's non-interactive styling).
-   1f9fcc1: Fix long-answer question fields rendering collapsed to a single line instead of sizing to fit their content. A long-text question nested inside a Conditional Section stayed collapsed until the respondent typed in it, because the auto-grow behavior ran on hidden textareas (always 0 height) and never re-ran once the section was revealed. Long-text fields also had no styling at all outside the plain Fair Form block (e.g. in the Event Signup blocks), and could grow without limit; they now cap at roughly 12 lines and scroll internally beyond that.
-   d18cf6a: Fix the admin events calendar on mobile: the header no longer overflows, small viewports show an agenda list of day cards instead of a squeezed 7-column grid, a month with no events says so instead of rendering a blank strip, and on touch tablets the per-day add button no longer needs a hover to appear.
-   Updated dependencies [7281a45]
-   Updated dependencies [84cfda0]
-   Updated dependencies [8d196d7]
-   Updated dependencies [9ae94d2]
-   Updated dependencies [1f9fcc1]
    -   fair-events-shared@0.5.0

## 1.11.0

### Minor Changes

-   a7c09e1: Add CSV export and a mailing opt-ins filter to the Signups tab, a From-URL tab on the Quick Add Event modal that prefills from a pasted page's schema.org/Open Graph data, an edit-tickets link on the Event Signup block sidebar, and a display-only shaded mini-calendar on the Sale Periods panel (replacing the old click-to-move-boundary interaction) whose colors now match the sale-period table. Nest generated series occurrences under their master in All Events instead of listing them as untitled top-level rows, carry event location through the public events feed and ICS mirror, and mark free RSVP/zero-priced ticket types as accessible-for-free in JSON-LD. Replace the series-modal date pickers with a shared click-to-pick MiniCalendar, give fair-events its own "Powered by" branding so attribution keeps showing without fair-audience active, and standardize remaining block buttons on core Button styles. Fix ticket sale-end dates freezing on series conversion, the editor preview order mismatching the frontend for Event Signup, a stale link_type desyncing the Manage Event context header from the actual linked post, the Tickets tab payments warning misfiring on every site, an unreadable calendar subscribe button before hover, invalid VTIMEZONE/all-day dates in the ICS feed, and drop the unused event_participants.transaction_id column and the Add-on collaborator discount ticket option.

### Patch Changes

-   Updated dependencies [a7c09e1]
    -   fair-events-shared@0.4.0

## 1.10.0

### Minor Changes

-   6973be8: Add a unified event-signup block (aliasing get-tickets), a subscribe link on the events-calendar block, a public ICS calendar feed endpoint, irregular (hand-picked date) recurring series, a richer Quick Add Event modal (categories, linking, recurrence), and a redesigned Manage Event header. Fill in JSON-LD/OpenGraph event markup (offers, location, eventStatus, ItemList) across calendar and week blocks, and reflect the selected occurrence in that metadata and the admin bar. Simplify ticket setup to a single sale period by default and route event feeds through a consolidated EventFeedProvider pipeline. Fix the week block to honor all start-of-week days and stop manual/irregular series from dropping an edited master date.

## 1.9.0

### Minor Changes

-   612b9b0: Creating an unrecognized category in the Manage Event Categories field no longer silently drops it: unknown tokens now POST to a create-category endpoint and get linked once the term exists (issue #992). The endpoint moves from `fair-events-experimental` (behind the sources feature flag) to stable `fair-events`, since the base Manage Event page needs it regardless of which extensions are active.
-   612b9b0: Materialize cancelled recurring occurrences into real rows (new `status` and `recurrence_mode` columns) instead of a serialized exdates blob on the master, and switch inheritable instance fields (title, venue, address, link type, capacity, price) to NULL-means-inherit so an override is distinguishable from an inherited copy. Cancelling now soft-cancels instead of deleting, and a previously-cancelled occurrence restores to active if it reappears in the recurrence rule (issue #996).
-   612b9b0: Restructure the Manage Event Tickets tab so the editable price table is the primary content instead of a duplicate read-only summary, demote Export/Import into a header dropdown, and surface a direct link when payments aren't configured for a priced event (issue #988).

### Patch Changes

-   e84e6b3: Move the galleries and messaging bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `PhotoParticipant`/`GalleryAccessKey` and `CustomMailMessage`/`ExtraMessage`/`ScheduledMessage` (plus their repositories, controllers, admin pages, media-library hooks, and the scheduled-message cron) are renamed to `FairAudienceExperimental\…` and now travel with the companion; every cross-plugin call site (`fair-events-experimental`'s gallery endpoint, stable `fair-events`' gallery page, `fair-form`'s questionnaire photo tagging, and core `fair-audience`'s email service and anonymization service) degrades gracefully via `class_exists()` guards when the companion is inactive.
-   a7f7373: Fix recurring standalone occurrences linked to a post via "Link Existing Event" rendering as a plain unstyled span instead of a button link in the calendar block. `get_display_url()` now falls back to the junction-linked post's permalink, and the calendar renders a link whenever a URL is available, not just for external link type.
-   b007d8a: Centralize ticket price resolution in a new `FairEvents\Services\TicketPricing` service and a shared `ticket-pricing.js` module, so the fair-events get-tickets purchase paths and the fair-audience event-signup pricing agree on price. Previously get-tickets used a closed `[sale_start, sale_end]` sale-period interval while fair-audience used a half-open `[sale_start, sale_end)` interval with a `continues_pricing_period` fallback — the two could charge different prices for the same ticket type on a sale period's end day. get-tickets now uses the half-open convention too.
-   a7f7373: Replace the generic `window.confirm()` on event delete with a `ConfirmDialog` that names the event and, for recurring masters, states the occurrence count that will be removed.
-   f92bab0: Disable the Tickets, Signups, Finance, Groups, Audience, Mailings, and Statistics tabs on the Manage Event page when the event's link type is External URL, since there is no registration behind those tabs for link-only events.
-   a7f7373: Apply the `fair_events_enabled_features_map` filter in the Gutenberg sidebar metabox localization, matching the Manage Event admin page. This was preventing extensions (e.g. fair-events-experimental) from enabling the venue-selection feature in the sidebar, which always rendered a plain address field instead of the venue dropdown.
-   612b9b0: Reject empty/whitespace-only event titles in the quick-create button and the create/update REST endpoints (update never validated title at all), and show a shared "(untitled event)" fallback label everywhere a title is rendered so legacy untitled rows stay legible (issue #990).
-   a7f7373: Only append the `event_date` query arg on calendar and week block links for events with more than one occurrence, avoiding unnecessarily long URLs for single-occurrence events.
-   0603413: Extract the weekly event aggregation logic into a stable `FairEvents\Services\WeeklyEventsProvider`, so it can be reused by the upcoming fair-audience weekly digest without depending on the experimental plugin (issue #916).
-   a7f7373: Fix All Events showing the wrong time compared to Manage Event/DB. `start_datetime` is a naive site-local string that was being formatted with `dateI18n`'s default timezone handling, shifting the displayed time whenever the browser and site timezones differ. It's now tagged as UTC and rendered with `gmdateI18n` so the wall-clock value passes through unchanged.
-   a7f7373: Fix the Sale Periods summary always rendering "1 days before event" — the days-before label now uses `_n()` so the count picks the correct plural form.
-   a7f7373: Fix untranslatable string concatenation on the Manage Event page. The linked-posts notice and the sale period label built sentences by concatenating separate `__()` fragments, which translators can't reorder for languages with different word order; both now use `_n()` and `sprintf()` for proper pluralization and ordering.
-   a7f7373: Add a context header to the Manage Event page showing the date/time, a series/occurrence badge, and link status directly under the H1, and move the recurring-occurrence notice there so it's visible without scrolling.
-   612b9b0: Move Manage Event's single global "Save Changes" button into the Event Details and Tickets tabs it actually applies to, labeled by what each saves, with per-section dirty-state tracking, a beforeunload guard, and an inline "Title is required" message instead of a silently disabled button (issue #987).
-   612b9b0: Add a Move action on the Manage Event Audience tab to re-point a participant's signup to a sibling occurrence of a recurring event in one step, instead of deleting and re-adding and losing attendance state, admin comments, ticket options, and payment status (issue #954). Adds `GET /event-dates/{id}/siblings` to fair-events and `POST .../participants/{id}/move` to fair-audience.
-   a7f7373: Fix the standalone get-tickets block (used when fair-audience is inactive) rendering an empty form for a specific occurrence of a recurring event. Ticket types, sale periods, and prices now resolve against the series master's configuration while the signup itself stays linked to the specific occurrence, mirroring the pivot fair-audience's event-signup block already does.
-   a7f7373: Remove the seats-per-ticket capacity weighting feature. It let a ticket type consume more than one capacity slot, forcing every capacity query, signup projection, and participant snapshot to carry a per-row seat weight. Capacity math now collapses back to a plain row count; the Seats column/checkbox, the `seats_per_ticket` column, and the `seats` column on `event_participant` are dropped, with a forward migration for existing installs.
-   612b9b0: Reword the Link Options card, ticket settings, add-on panel, All Events list, and transaction "Metadata" card (now "Details") to use organizer task language instead of internal data-model vocabulary (Master/Generated, "Event placeholder", "activity"), per UI_GUIDELINES.md. Display strings only — no REST field or DB value changes (issue #989).
-   a7f7373: Fix calendar events grouped by day rendering in fetch order (WordPress query, standalone query, iCal feed) instead of start time, causing mixed-source events on the same day to appear out of chronological order.
-   Updated dependencies [b007d8a]
-   Updated dependencies [612b9b0]
-   Updated dependencies [612b9b0]
    -   fair-events-shared@0.3.0

## 1.8.0

### Minor Changes

-   551e827: Add three-level email consent (Yes / missing / No): new `declined` profile value records that a participant was asked and refused, a renamed `marketing-consent` endpoint handles both upgrade and decline in one request, and the event-floor consent modal lets organizers record Yes/No per row. All-participants table, edit modal, and participant detail now display the declined state.
-   2cb0fb8: Move the Audience, Groups, and Mailings tabs out of fair-events and into fair-audience, which now owns audience-facing management for an event. fair-events registers the extension point and fair-audience renders these tabs, consolidating participant and mailing management in one plugin.
-   2cb0fb8: Add a shared payment-integration lifecycle layer in fair-events-shared that standardizes how plugins hook into payment start, completion, and failure. fair-payments-connector's simple-payment block and fair-events' get-tickets block consume the shared layer so payment side-effects are handled consistently across integrations.
-   2cb0fb8: Classify the impact of edits to recurring events and guard against destructive changes: the server categorizes how a change affects existing occurrences and surfaces that impact in the UI before saving. Occurrence reconciliation now preserves existing row IDs instead of regenerating them, and generated occurrences fall back to the master venue when they have none of their own.
-   2cb0fb8: Add recurrence scope for ticket types on recurring events: a ticket type can apply to a single occurrence or to `multiple_instances`. A scope-choice modal prompts the organizer when editing ticket types on a recurring event, the Ticket Prices table shows the active scope in parentheses, and sold ticket types are locked against scope changes. The event-signup block respects the resolved scope when listing available tickets.
-   2cb0fb8: Remove the simple ticket pricing mode; advanced ticketing is now the only pricing model. Events that used simple pricing are handled through the advanced ticket-type flow, simplifying the manage-event UI, the REST payload, and the underlying models. Organizers who relied on simple pricing will now manage prices as ticket types.
-   2cb0fb8: Add sliding-scale (pay-what-you-can) event pricing: organizers can offer a ticket type where the buyer chooses the amount within a configured range. The manage-event admin UI exposes the new pricing mode, the event-signup block lets attendees enter their own price, and the server validates the chosen amount against the configured bounds.
-   7e594d7: Add manual disable/enable for sold ticket types: a new `disabled` boolean column on ticket types lets admins hide a type from the signup form without deleting it. The admin UI replaces the Remove button with an Enable/Disable toggle when the type has sales. The server guards against deleting sold types omitted from the payload (defense in depth). The event-signup block and the GetTickets gate both respect the flag.
-   9dd9cc4: Replace the manual `google_maps_link` venue field with a computed `maps_url`: the server now generates the Google Maps URL from latitude/longitude (exact pin) or falls back to the address (approximate). The `google_maps_link` DB column is dropped via migration 3.16.0 and removed from the admin form, REST API, and frontend block.

### Patch Changes

-   2cb0fb8: Bump @wordpress/components 35→36 and @wordpress/dataviews 16→17. The DataViews upgrade can change table rendering in the admin views that use it, so the shipped bundles for these plugins are regenerated.
-   2cb0fb8: Move the Statistics, Duplicate, and Merge actions into the manage-event tab descriptor registry, and render the Statistics tab inline instead of redirecting to a separate page. fair-events exposes the tab registry extension point that fair-events-experimental registers against.
-   ce4566c: Fix paid get-tickets purchases dumping the buyer on the homepage after checkout. The redirect URL was built with `get_permalink()` inside the REST request, where there is no post context, so it always fell back to `home_url()` — a page without the block, so the buyer never saw a confirmation. The controller now resolves the return URL from the same-site referer (preserving `?event_date=` on standalone pages), falling back to the event's own page, then the homepage.
-   Updated dependencies [2cb0fb8]
    -   fair-events-shared@0.2.0

## 1.7.0

### Minor Changes

-   c60efeb: Add a `get-tickets` block for standalone ticket purchase: a server-rendered block that lets visitors buy tickets from any WordPress page without requiring fair-audience. The block resolves the target event date from the query string, a block attribute, or the post's own event date.

    Add `recurrence_scope` to ticket types, allowing each type to be scoped to a single occurrence or to the whole recurring series.

-   efb62fa: Move TicketSalePeriod, TicketType, and TicketPrice models from fair-events-experimental into fair-events (namespace FairEvents\Models), and refactor sale periods to half-open day ranges [sale_start, sale_end) in the site timezone with two seeded defaults (before / during the event).

### Patch Changes

-   c60efeb: Fix three visual/functional regressions in the events-week block: use block palette colors for external events (not just internal ones); constrain event chips to their column width so they don't overflow; add a clipboard API fallback so the copy button works in browsers that block `navigator.clipboard` without HTTPS.
-   c60efeb: Several manage-event UI improvements: link the event title in the manage-event header to the frontend page; hide the Groups tab and group-discount fields when fair-audience is not active; use descriptive labels ("Before event" / "During event") for the two seeded default sale-period columns; remove the capacity line from the get-tickets block render.

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
