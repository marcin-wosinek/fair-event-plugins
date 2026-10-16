## Purpose

A compact summary of an event: its dates and, when set, its venue (name,
address, and a map link). For recurring events it also explains which session
is shown and links back to the series overview.

## Composition

No inner blocks and no parent restriction. Place it on an event post, a page
linked to an event, or a single-event template (it reads `postId` from block
context).

## Attributes

None of its own beyond `anchor` and `align` supports.

## Prerequisites

- The current post must have a Fair Events event date (a `fair_event` post or
  a post linked to an event date); otherwise nothing renders.
- A venue is shown when the event date references a venue (Fair Events →
  Venues) or has an inline address.
- `?event_date=<YYYY-MM-DD>` selects one session of a recurring event. An
  explicit selection that does not belong to this event renders "This session
  is unavailable" with a link to the event; it never substitutes another
  session.

## Rendering

Renders `.wp-block-fair-events-event-info` with the formatted dates and venue
details. On a recurring event without a selection it describes the series;
for a past session it states that the session has ended.
