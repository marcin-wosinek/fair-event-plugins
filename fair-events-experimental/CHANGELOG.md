# fair-events-experimental

## 1.11.0

### Minor Changes

-   946a907: Sell priced add-ons with Fair Events alone. Add-ons (activities) configured on an event's Tickets tab — with one flat price or a price per sale period — now appear on the signup form and are charged at checkout without Fair Audience or Fair Events Experimental. Each add-on is charged once for every ticket that selects it, and the total shown on the form is the amount charged.

    An add-on that has no price for the sale period currently on sale is no longer offered, and a purchase that still selects it is refused with a message naming it instead of the add-on being given away. An add-on priced at zero stays free, and can now be combined with a paid ticket. Add-ons that are full are marked as full for every visitor.

    Existing add-ons, their prices, past selections and pending payments are kept as they are. With Fair Audience active, its signup and add-activities flows use the same prices and rules, and group discounts keep applying on top.

    For developers: `TicketOption`, `TicketOptionPrice`, `ActivityOptionPriceResolver` and `ActivityOptionTranslation` moved from `FairEventsExperimental` to the matching `FairEvents` namespaces (the old names remain as aliases while Fair Events Experimental is active). Fair Events builds add-on line items itself; the `fair_events_signup_option_line_items` filter is replaced by `fair_events_signup_option_prices`, which only adjusts prices.

-   5547fdb: The Telegram bot token for weekly notifications is now managed in Settings → Connectors, and the plugin requires WordPress 7.0 or newer. A token saved earlier keeps working without being entered again. Weekly notifications shows whether a token is configured and links to Connectors; the chats, schedule, preview and test send stay where they were. The token can also come from an environment variable or PHP constant named `FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN`, which take precedence over the saved one. A missing or malformed token stops test and scheduled sends before anything reaches Telegram and says why. Send a test summary to confirm Telegram accepts the token.
-   64c0160: Plan a workshop schedule in Manage Event. With Fair Events Experimental active, Manage Event → Prices → More options has a new **Workshop schedule** setting; once saved, a **Schedule** tab appears after Prices. There you add each add-on as a workshop with its date, start and end time, room or location and description — its name, price and capacity stay in Prices — and add schedule items such as breaks, which are never a ticket choice. Workshops may run at the same time, also in the same room. A workshop can be marked **Not bookable**: it stays on the schedule and leaves the signup form, and purchases that try to include it are refused. That switch is refused while tickets or reservations include the workshop, and an add-on that is on the schedule cannot be deleted or replaced by an import in Prices. A series keeps one schedule, managed on the series and shifted to each of its dates; copying an event copies its schedule. Turning the setting off hides the tab and keeps the entries and their booking status. Fair Audience no longer accepts a not-bookable workshop in its own signup routes.

### Patch Changes

-   Updated dependencies [f49cee6]
-   Updated dependencies [946a907]
-   Updated dependencies [fbd90d6]
-   Updated dependencies [9413f36]
-   Updated dependencies [4ecd614]
-   Updated dependencies [e751903]
-   Updated dependencies [3a7b83d]
-   Updated dependencies [a5b30c4]
-   Updated dependencies [1da561f]
-   Updated dependencies [85e31c0]
-   Updated dependencies [d39f0cb]
-   Updated dependencies [c65bf49]
-   Updated dependencies [a80905e]
-   Updated dependencies [c0c3d69]
-   Updated dependencies [64c0160]
    -   fair-events@1.21.0

## 1.10.0

### Minor Changes

-   2ad15e0: Add a Compare events page to the Events menu, just before Event Sources. Pick a current event and a comparison event to see their cumulative tickets sold and sales amount on the same charts, lined up by the days before each event. The selection is kept in the page link, so a comparison can be shared or reloaded, and each chart downloads as a PNG naming both events.
-   064980e: Fair Events Experimental settings now live in an Experimental tab of Fair Events → Settings instead of their own menu entry. The tab holds the same feature toggles, weekly notifications and Meta Conversions settings, with their saved values unchanged, and only administrators can open it. Links to the former Experimental Settings page redirect to the new tab, and the selected tab is kept on reload and in bookmarks. Without Fair Events Experimental, the Settings page shows its other tabs as before. The Settings tabs now wrap onto a second row on narrow screens.
-   f85bc20: Removed the Migrate Posts to Events and Migration Summary admin pages, the "Migration" feature toggle, and their REST routes, including the orphan repair and deletion actions. Old bookmarks to these pages and a previously saved "Migration" setting no longer bring them back. Previously migrated events, their dates and relationships, and all other stored data stay as they are; Fair Events' own database upgrades are unaffected.
-   22a1e88: Event statistics now count confirmed tickets instead of participants. A purchase of three tickets adds three to the total and the cumulative chart, and cancelling or refunding one ticket removes one. Whole-series tickets count once on each occurrence they cover. The activity charts show tickets per activity and activities per ticket, with a notice for older tickets whose activities were recorded per participant. Revenue is unchanged.
-   928d9f2: Move event Statistics into Fair Events. The Statistics tab on Manage Event and the standalone Statistics page no longer need Fair Events Experimental, and the page explains when Fair Audience is missing. The statistics endpoint now lives at `/fair-events/v1/event-dates/{id}/statistics`; the former `/fair-audience/v1/...` path keeps working as an alias. Experimental's "Audience statistics" setting is retired.
-   ceefad4: Weekly Telegram notifications are easier to read: the calendar title is a link, the date range has its own line, and each event is a bullet with its weekday, time and linked title instead of `*` markers and full URLs. Titles with characters such as `*`, `_` or `[` are shown exactly as written. The "Send test summary to Telegram" button now sends the next scheduled week's real summary, and the preview shows each Telegram message with its links. The Events Week "copy summary" text is unchanged.
-   da72269: Post the week's events from an event source to Telegram on a weekly schedule, in the same format as the calendar's copy-summary button. Any published, public page can head the message with its title and link; it does not need to show a calendar. The Events Week View heading now shows the right dates on sites west of UTC.

### Patch Changes

-   9a6f852: With a Telegram bot token saved, Weekly notifications now shows "A bot token is saved" without a token field. You can change the schedule, chats or other settings and save them without re-entering the token. Browser autofill can no longer replace the token or block the save. To change the token, choose "Replace bot token". "Keep saved token" discards the new value. If the new token is rejected, the saved token and other settings stay unchanged and the new value stays in the field so you can correct it.
-   Updated dependencies [7419f12]
-   Updated dependencies [93df554]
-   Updated dependencies [8ddfbc2]
-   Updated dependencies [f6f2aa4]
-   Updated dependencies [296c5a0]
-   Updated dependencies [064980e]
-   Updated dependencies [f7510c6]
-   Updated dependencies [7c509c1]
-   Updated dependencies [f62e157]
-   Updated dependencies [4a4d8f1]
-   Updated dependencies [928d9f2]
-   Updated dependencies [ceefad4]
-   Updated dependencies [98c6e65]
-   Updated dependencies [e803bba]
-   Updated dependencies [903d362]
-   Updated dependencies [da72269]
    -   fair-events@1.20.0

## 1.9.0

### Minor Changes

-   1246f44: Remove the event photo gallery. The Photos tab of Manage Event, the public gallery page, photo likes and downloads, gallery access links, the "Send Gallery Link" action, the gallery count on Event Participants and the Images/Likes columns of By Event are gone, together with their REST routes. Old `?gallery_key=`, `?event_gallery_id=` and `/event-gallery/{id}` links now answer 410 Gone without checking the token. On upgrade, the gallery relationship, likes and access key tables are dropped; the cleanup can safely repeat and is retried until it succeeds. Media files, photo authors and tags, participant and questionnaire photo uploads, and event promotional images are kept. In fair-audience-experimental the retained photo upload and attribution features move from the `galleries` bundle to a new `photos` bundle, which inherits the stored choice. See DEPLOYMENT.md for backup and rollback steps.
-   3af47de: Add a "Download PNG" action to the Cumulative sales and Cumulative sales amount charts on the event Statistics tab. Each image includes the event name, the chart title, and the complete chart, and is saved under a filename that identifies both the event and the chart. The event name now also appears as a subtitle on those two charts. The event statistics endpoint returns the event's display name as `event_name`.

### Patch Changes

-   afe881c: Add an Event Prices block that displays an event's public ticket prices — enabled ticket types, sale periods, and their formatted prices — directly from the linked event's Prices tab, automatically following the visitor's selected recurring-event occurrence. Free, unavailable, and disabled tickets are shown without implying they can be purchased.

    Ticket pricing across the signup and purchase flows now treats only an explicitly stored zero price as free. A ticket type with no price row at all is unavailable rather than free by convention, matching what the new block (and the Prices tab) shows — closing a gap where a ticket that looked unavailable could previously still be purchased for free at checkout.

-   Updated dependencies [6be67b2]
-   Updated dependencies [9351bf8]
-   Updated dependencies [1e1d6c8]
-   Updated dependencies [c41124a]
-   Updated dependencies [afe881c]
-   Updated dependencies [52ab256]
-   Updated dependencies [3ba3169]
-   Updated dependencies [67f7bf6]
-   Updated dependencies [c9df2f7]
-   Updated dependencies [4d692f4]
-   Updated dependencies [6d00587]
-   Updated dependencies [1161686]
-   Updated dependencies [74f0e21]
-   Updated dependencies [82c3b5c]
-   Updated dependencies [1246f44]
-   Updated dependencies [eaa4a73]
-   Updated dependencies [4141d59]
-   Updated dependencies [ab5c597]
-   Updated dependencies [66142ed]
-   Updated dependencies [48f7df4]
-   Updated dependencies [cec5507]
    -   fair-events@1.19.0

## 1.8.0

### Minor Changes

-   dde767a: Add net paid sales totals and cumulative revenue charts to event statistics, including refund timing, transaction deduplication, and currency-mismatch warnings.
-   0938a8f: Show a "Recent test sends" history on the Meta Conversions settings page, so an administrator can see the outcome of each PageView/InitiateCheckout/Purchase test event sent to Meta Test Events even after the toast notice has disappeared.
-   fefc867: Report both test-mode and live-mode checkouts/purchases to Meta Test Events (using the configured Test Events code), tagging each delivered event with its payment mode so administrators can distinguish test traffic from live sales in delivery diagnostics.
-   6027ac1: Add separate Meta Test Events buttons for PageView, InitiateCheckout, and Purchase on the Meta Conversions settings screen, so an administrator can verify each event type independently in Meta Test Events. Each button names the event it sent in its success or failure notice, and every button is disabled with an inline explanation until configuration is complete and saved. Synthetic test events never carry a stored transaction or order ID.
-   06c470f: Warn on the Meta Conversions settings screen when the WP Consent API is unavailable, since live checkout and purchase tracking cannot capture attribution without it. The warning links to the WP Consent API plugin and clears automatically once the API is available; synthetic Test Events remain unaffected.

### Patch Changes

-   23998c9: Meta Conversions now delivers routine checkout and purchase events as production Meta events — no `test_event_code` is attached — for both test-mode and live-mode payments, so real sales are correctly measured instead of being reported only to Meta Test Events. `custom_data.payment_mode` still distinguishes test-mode transactions from live sales. The configured Test Events code is now used exclusively by the explicit "Send test event" diagnostic action; routine delivery no longer requires it to be configured.
-   4a51db8: Make the Meta Conversions "Recent delivery outcomes" list on the Experimental Settings page useful for troubleshooting: each result now shows a readable status, Test/Live mode, the site-local update time, a labeled attempt count, and a safe failure category/code for retrying or failed deliveries. Summary counts use the same readable labels, and an empty state appears when there are no results yet.
-   d0dd54a: Keep cumulative sales charts anchored to the event date while distinguishing recorded sales from the future event horizon.
-   Updated dependencies [19d0333]
-   Updated dependencies [d4bea94]
-   Updated dependencies [0a5131a]
-   Updated dependencies [7362ce4]
-   Updated dependencies [e3fa379]
-   Updated dependencies [ac6da68]
-   Updated dependencies [65b371a]
-   Updated dependencies [5290dc9]
-   Updated dependencies [7318848]
-   Updated dependencies [aa0b8ef]
-   Updated dependencies [4a91d09]
-   Updated dependencies [c894b20]
-   Updated dependencies [1a49cff]
-   Updated dependencies [2f0d149]
-   Updated dependencies [452cc30]
-   Updated dependencies [1323dfa]
    -   fair-events-shared@0.6.2
    -   fair-events@1.18.0

## 1.7.0

### Minor Changes

-   a6fc9d8: Add opt-in, consent-gated Meta Conversions API reporting for ticket checkout and confirmed live purchases, with write-only credentials, asynchronous delivery, bounded retries, sanitized diagnostics, and 90-day retention.
-   8e78b19: Add server-backed cumulative event sales statistics and a responsive sales summary chart.

### Patch Changes

-   Updated dependencies [a6fc9d8]
-   Updated dependencies [68a8253]
-   Updated dependencies [71b5b84]
-   Updated dependencies [82845f8]
-   Updated dependencies [5336197]
-   Updated dependencies [448d0e2]
-   Updated dependencies [a96d4f1]
-   Updated dependencies [40b0d52]
-   Updated dependencies [3d41a7c]
-   Updated dependencies [c95e170]
-   Updated dependencies [b3a74fa]
-   Updated dependencies [8c56f63]
-   Updated dependencies [66ae888]
-   Updated dependencies [adf8ba3]
-   Updated dependencies [f8a2b3a]
-   Updated dependencies [2971a6b]
-   Updated dependencies [ac04ebc]
-   Updated dependencies [6aec874]
    -   fair-events@1.17.0
    -   fair-events-shared@0.6.1

## 1.6.1

### Patch Changes

-   d3f3bee: Make the basic event Copy flow available without Fair Events Experimental while keeping advanced Duplicate and Merge tools experimental.
-   47b9041: Persist and enforce audience-group ticket restrictions without requiring Fair Events Experimental.
-   Updated dependencies [f12c183]
-   Updated dependencies [faf5f85]
-   Updated dependencies [14dd888]
-   Updated dependencies [04cce70]
-   Updated dependencies [bca9fd4]
-   Updated dependencies [41cdb3c]
-   Updated dependencies [d3f3bee]
-   Updated dependencies [f45f69a]
-   Updated dependencies [cd96441]
-   Updated dependencies [47b9041]
    -   fair-events@1.16.0

## 1.6.0

### Minor Changes

-   990ff3e: Remove the "Venues" bundle — the Venues admin page, model, and REST controller now live in Fair Events core and are always available there.

### Patch Changes

-   4d4aeae: Register activity option (ticket option) names and short names for Polylang string translation, so multilingual sites can translate them and have the translation appear on the public signup form.
-   Updated dependencies [8e06c54]
-   Updated dependencies [049bf89]
-   Updated dependencies [6920161]
-   Updated dependencies [d64b596]
-   Updated dependencies [c40036a]
-   Updated dependencies [990ff3e]
-   Updated dependencies [8d9430e]
-   Updated dependencies [4d4aeae]
-   Updated dependencies [840488b]
-   Updated dependencies [bb63051]
-   Updated dependencies [c8b1abf]
-   Updated dependencies [6462cc8]
    -   fair-events@1.14.0

## 1.5.0

### Minor Changes

-   f62946d: Duplicate Event wizard's Tickets step now uses the same ticket editor as Manage Event, fixing silent data loss when toggling multiple sale periods off and preserving series ticket scope (whole series / multiple instances) on duplicated events. The step also gains sale-periods calendar, add-ons, and capacity display, and is now hidden when the ticketing feature is off.
-   a6419da: Validate venue latitude/longitude on save (form and API), accepting a decimal comma and auto-splitting a pasted "lat, lng" pair, and skip invalid coordinates (with a notice) instead of importing them unchecked.

### Patch Changes

-   5fe6658: Reduce the database queries issued when rendering or purchasing through the Event Signup form: the active sale period, the viewer's group memberships, and the event's discount rules are now resolved once per render/request and reused across every ticket tier and activity, instead of being re-resolved once per tier. Query count no longer scales with the number of ticket tiers; displayed and charged prices are unchanged.
-   4eb856e: Fix the group discount note on the signup form so it always matches the price actually charged: it now compares each rule against the ticket's real price (not a notional reference price), stays hidden unless a price is genuinely reduced, and shows fractional percentages (e.g. 12.5%) without rounding them away. When different ticket tiers get their best price from different rules, the shared note is dropped in favor of a per-tier label.
-   Updated dependencies [e0ea5a6]
-   Updated dependencies [4b9d893]
-   Updated dependencies [4ec1056]
-   Updated dependencies [5fa6fd6]
-   Updated dependencies [5fe6658]
-   Updated dependencies [0e27b5c]
-   Updated dependencies [3508d85]
-   Updated dependencies [1a85cf6]
-   Updated dependencies [f62946d]
-   Updated dependencies [58e85f6]
-   Updated dependencies [1d9d738]
-   Updated dependencies [c30daa6]
-   Updated dependencies [0a116a2]
-   Updated dependencies [c5c60b7]
-   Updated dependencies [64ffbf9]
-   Updated dependencies [09d5d55]
-   Updated dependencies [49f2e0a]
-   Updated dependencies [089a463]
-   Updated dependencies [b138421]
-   Updated dependencies [d51522b]
-   Updated dependencies [aeda159]
-   Updated dependencies [bab5a8a]
-   Updated dependencies [f64745d]
-   Updated dependencies [fc86b53]
-   Updated dependencies [172880a]
-   Updated dependencies [7932bb2]
    -   fair-events@1.13.0
    -   fair-events-shared@0.6.0

## 1.4.1

### Patch Changes

-   1c4ac34: Removed the invitation-gated ticket signup mechanism: the "invitation only" ticket type toggle, the Manage Invitations admin page and its REST routes, and the public signup form's `?invitation=` link handling and "show inviter's name" option. The gating check had silently broken (an autoloader namespace mismatch made it dead code — invitation-only ticket types were already invisible on the public form, not merely restricted), so a migration disables any ticket type that was previously marked invitation-only rather than making it suddenly public, and drops the now-unused `invitation_only` column and `fair_events_invitation_tokens` table. Group-restricted ticket types and the separate bulk "send invite emails" outreach feature are unaffected.
-   ab61aba: Fixed a PHP 8.2 dynamic-property deprecation notice that fired on nearly every event-date read (`EventDates::$signup_price`, left over from a partially-reverted merge). Rather than re-declaring the field, finished removing it: the flat per-date "simple pricing" mode and pay-what-you-can sliding scale it powered were already superseded by ticket-type pricing everywhere except the legacy fair-audience Event Signup block, which now prices signups from ticket types only. The `signup_price` column is dropped from the event dates table via migration. Also fixed the same class of deprecation notice on `FairAudienceExperimental\Models\Group::$member_count`, populated by the groups admin list.
-   Updated dependencies [7281a45]
-   Updated dependencies [84cfda0]
-   Updated dependencies [8d196d7]
-   Updated dependencies [9ae94d2]
-   Updated dependencies [1f9fcc1]
    -   fair-events-shared@0.5.0

## 1.4.0

### Minor Changes

-   a7c09e1: Remove the Add-on collaborator discount ticket option; signup now always charges the add-on's regular price.

### Patch Changes

-   Updated dependencies [a7c09e1]
    -   fair-events-shared@0.4.0

## 1.3.2

### Patch Changes

-   6973be8: Simplify ticket setup to a single sale period by default.

## 1.3.1

### Patch Changes

-   3e34be8: Move the groups and invitations bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `Group`/`GroupParticipant` and their repositories are renamed to `FairAudienceExperimental\…` and now travel with the companion; every core `fair-audience` call site (participant lists, custom mail, payment discount labels, signup pricing, anonymization, the signups-list block) and the `fair-events-experimental` invitation-token controller degrade gracefully via `class_exists()` guards when the companion is inactive.
-   e84e6b3: Move the galleries and messaging bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `PhotoParticipant`/`GalleryAccessKey` and `CustomMailMessage`/`ExtraMessage`/`ScheduledMessage` (plus their repositories, controllers, admin pages, media-library hooks, and the scheduled-message cron) are renamed to `FairAudienceExperimental\…` and now travel with the companion; every cross-plugin call site (`fair-events-experimental`'s gallery endpoint, stable `fair-events`' gallery page, `fair-form`'s questionnaire photo tagging, and core `fair-audience`'s email service and anonymization service) degrades gracefully via `class_exists()` guards when the companion is inactive.
-   b007d8a: Centralize ticket price resolution in a new `FairEvents\Services\TicketPricing` service and a shared `ticket-pricing.js` module, so the fair-events get-tickets purchase paths and the fair-audience event-signup pricing agree on price. Previously get-tickets used a closed `[sale_start, sale_end]` sale-period interval while fair-audience used a half-open `[sale_start, sale_end)` interval with a `continues_pricing_period` fallback — the two could charge different prices for the same ticket type on a sale period's end day. get-tickets now uses the half-open convention too.
-   612b9b0: Creating an unrecognized category in the Manage Event Categories field no longer silently drops it: unknown tokens now POST to a create-category endpoint and get linked once the term exists (issue #992). The endpoint moves from `fair-events-experimental` (behind the sources feature flag) to stable `fair-events`, since the base Manage Event page needs it regardless of which extensions are active.
-   612b9b0: Extract the recurrence editor (RRULE parse/build helpers and the Frequency/Ends/Count/Until UI) out of three separately-maintained admin components into a shared `RecurrenceControl` in `fair-events-shared`, following the existing DateTimeControl/EventSourceSelector pattern (issue #977).
-   f92bab0: Disable the Tickets, Signups, Finance, Groups, Audience, Mailings, and Statistics tabs on the Manage Event page when the event's link type is External URL, since there is no registration behind those tabs for link-only events.
-   Updated dependencies [b007d8a]
-   Updated dependencies [612b9b0]
-   Updated dependencies [612b9b0]
    -   fair-events-shared@0.3.0

## 1.3.0

### Minor Changes

-   2cb0fb8: Move the Statistics, Duplicate, and Merge actions into the manage-event tab descriptor registry, and render the Statistics tab inline instead of redirecting to a separate page. fair-events exposes the tab registry extension point that fair-events-experimental registers against.
-   2cb0fb8: Add sliding-scale (pay-what-you-can) event pricing: organizers can offer a ticket type where the buyer chooses the amount within a configured range. The manage-event admin UI exposes the new pricing mode, the event-signup block lets attendees enter their own price, and the server validates the chosen amount against the configured bounds.
-   9dd9cc4: Replace the manual `google_maps_link` venue field with a computed `maps_url`: the server now generates the Google Maps URL from latitude/longitude (exact pin) or falls back to the address (approximate). The `google_maps_link` DB column is dropped via migration 3.16.0 and removed from the admin form, REST API, and frontend block.

### Patch Changes

-   Updated dependencies [2cb0fb8]
    -   fair-events-shared@0.2.0

## 1.2.0

### Minor Changes

-   efb62fa: Move TicketSalePeriod, TicketType, and TicketPrice models from fair-events-experimental into fair-events (namespace FairEvents\Models), and refactor sale periods to half-open day ranges [sale_start, sale_end) in the site timezone with two seeded defaults (before / during the event).

## 1.1.0

### Minor Changes

-   ead4d69: Add Duplicate Event, Merge Event, and Mailings tab features (moved from fair-events core)
-   82e6f21: Move Venue model and VenueController from fair-events to fair-events-experimental. The venues REST API (`/fair-events/v1/venues`) is now registered by the experimental plugin under its `venues` feature flag.

## 1.0.0

### Major Changes

-   f9e4993: Introduce fair-events-experimental plugin as an internal bundle for experimental feature flags and functionality.
