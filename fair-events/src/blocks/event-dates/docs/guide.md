## Purpose

Prints the date range of an event, formatted with the site's WordPress date
and time formats — for example "June 14, 2030 7:00 pm – 9:00 pm", or a date
range for all-day and multi-day events.

## Composition

Has no inner blocks and no parent restriction. Typical placements:

- In the content of an event post, or a page linked to an event.
- Inside the display pattern used by **Events List** (`fair-events/events-list`),
  where it shows the date of each listed occurrence.
- In a single-event template (it reads `postId` from block context).

## Attributes

None of its own beyond `anchor` and `align` supports.

## Prerequisites

- The post given by block context (`postId`, or the current post) must have a
  Fair Events **event date**: either a `fair_event` post, or another enabled
  post type linked to an event date in Fair Events. Without one the block
  renders nothing.
- `?event_date=<YYYY-MM-DD>` (or a legacy numeric event-date id) in the URL
  selects a specific occurrence of a recurring event; otherwise a recurring
  event shows today's or the next upcoming occurrence.

## Rendering

A single `div.event-dates` with the formatted text. Nested in an Events List,
it shows the occurrence (or recurring-series summary) the list selected.
