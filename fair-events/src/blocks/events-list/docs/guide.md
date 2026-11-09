## Purpose

A list of events — past, current, future, or any combination — rendered through a block
pattern, so the look of each item is designed in the editor rather than fixed
by the plugin.

## Composition

Top-level block without inner blocks; the per-event markup comes from the
pattern named in `displayPattern`. Event blocks such as Event Dates inside the
pattern show the data of each listed event.

## Attributes

- `timeFilters` — the periods to show, any of `past` (ended), `current`
  (started and not yet ended) and `future` (not started yet). An event is
  listed once when it matches any checked period. Only Past lists the most
  recent first; every other selection is soonest first. Only Future shows a
  recurring series from the site once, at its next date with its schedule;
  other selections list each matching date. An empty array shows no events,
  and the editor asks to check at least one period.
- `timeFilter` — the legacy single filter, used only when `timeFilters` is
  absent: `upcoming` (the default for a new block) is Future, `ongoing`
  Current, `past` Past, and `all` all three. Existing blocks keep their output
  without being re-saved.

  A date without an end time ends with its end date, so it stays current
  through that day and is past from the next. A date missing a time stays
  future until it ends.
- `categories` — post category term IDs; when non-empty only events in any of
  them are listed.
- `displayPattern` — the pattern used for each event (or the whole list):
  - bundled patterns: `fair-events/event-list` (default) or
    `fair-events/event-grid`;
  - a synced pattern from the site: `wp_block:<post ID>`.
  A pattern containing a Query Loop (`core/query`/`core/post-template`) lists
  only events that are posts; any other pattern is rendered once per
  occurrence and also includes standalone and imported events. An unknown or
  deleted pattern renders a notice asking to choose another.
- `eventSources` — slugs of event sources (Fair Events Experimental → Event
  Feeds) whose imported iCal/API events and category filters are merged in.

## Prerequisites

Events in Fair Events. With none matching, the list renders empty (patterns
may provide their own "no results" content).

## Rendering

Renders `.wp-block-fair-events-events-list` containing the resolved pattern
output for each event, or the unavailable-pattern notice.
