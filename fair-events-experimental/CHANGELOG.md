# fair-events-experimental

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
