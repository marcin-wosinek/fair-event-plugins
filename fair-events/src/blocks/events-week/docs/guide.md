## Purpose

A seven-day grid of events for one week, with navigation between weeks
(Interactivity API, no full reload). Optionally offers a plain-text summary of
the week that visitors can copy, for example to paste into a messaging group.

## Composition

Top-level block without inner blocks; supports wide and full alignment.

## Attributes

- `categories` — post category term IDs to filter by; empty shows all.
- `eventSources` — event source slugs (Fair Events Experimental → Event
  Feeds) whose imported events are included.
- `showNavigation` — previous/next week links. The URL parameter `week_view`
  selects the week.
- `showDrafts` — include draft posts linked to events.
- `showCopySummary` — show a "copy summary" control with the week's events as
  text.
- `backgroundColor`, `textColor`, `headerBackgroundColor` — a theme palette
  slug (default `primary`) or any CSS color.

## Prerequisites

Events in Fair Events; empty days render empty. The week starts on the site's
"Week Starts On" setting.

## Rendering

Renders `.wp-block-fair-events-events-week` with one column per day. The block
`anchor`, or `fair-events-week` by default, is the scroll target after
navigation.
