# fair-events-experimental

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
