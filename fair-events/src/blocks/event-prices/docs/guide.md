## Purpose

Shows an event's public prices as configured on its **Prices** tab in Fair
Events: ticket types (for example "Regular", "Student") and how their prices
change across sale periods (for example "Early bird", "Regular", "At the
door"). It is informational; to sell tickets use **Event Signup**
(`fair-events/event-signup`).

## Composition

No inner blocks and no parent restriction. Place it on an event post, a page
linked to an event, or a single-event template (`postId` block context).

## Attributes

- `hiddenTicketTypeIds` — ticket type IDs to leave out of the table, for
  example internal or group-restricted tiers.
- `hiddenSalePeriodIds` — sale period IDs to leave out.

Both default to `[]` (show everything public). IDs belong to the event the
block is placed on; IDs of another event have no effect.

## Prerequisites

- The current post must have a Fair Events event date with at least one
  public price (Ticketing must be enabled in Fair Events settings, which it is
  by default). Otherwise the block renders nothing on the frontend; in the
  editor it shows a placeholder explaining why.
- Generated occurrences of a recurring event use the series master's prices.
- `?event_date=<YYYY-MM-DD>` selects the occurrence, as for Event Info.

## Rendering

Renders `.wp-block-fair-events-event-prices` with a table of ticket types and
their prices per sale period, highlighting the period currently on sale.
