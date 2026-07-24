# fair-events-experimental

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
