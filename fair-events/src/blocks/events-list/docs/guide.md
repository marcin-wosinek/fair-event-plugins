## Purpose

A list of events — upcoming, past, ongoing, or all — rendered through a block
pattern, so the look of each item is designed in the editor rather than fixed
by the plugin.

## Composition

Top-level block without inner blocks; the per-event markup comes from the
pattern named in `displayPattern`. Event blocks such as Event Dates inside the
pattern show the data of each listed event.

## Attributes

- `timeFilter` — `upcoming` (default; start in the future, soonest first),
  `past` (ended, most recent first), `ongoing` (started and not yet ended), or
  `all`. A missing end time counts as equal to the start.
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
