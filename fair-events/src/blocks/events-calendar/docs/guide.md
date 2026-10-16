## Purpose

A month grid of events. Each day lists its events; visitors move between
months without a full page reload (Interactivity API) and can subscribe to
the site's calendar feed.

## Composition

Top-level block without inner blocks; supports wide and full alignment.

## Attributes

- `currentMonth` / `currentYear` — the month shown when the URL does not say
  otherwise, as a two-digit month (`"01"`–`"12"`) and a four-digit year
  (`"2030"`). Empty (default) means the current month. The URL parameters
  `calendar_month` / `calendar_year` (set by navigation) take precedence.
- `categories` — post category term IDs to filter by; empty shows all.
- `eventSources` — event source slugs (Fair Events Experimental → Event
  Feeds) whose imported events are included.
- `showNavigation` — previous/next month links.
- `showDrafts` — include draft posts linked to events (events drafted in Fair
  Events stay hidden). Intended for staff-facing pages.
- `showSubscribe` — show the calendar-feed subscribe link. The feed covers all
  public events regardless of this block's filters.
- `backgroundColor`, `textColor`, `headerBackgroundColor` — event chip and
  header colors: a theme palette slug (default `primary`) or any CSS color.
- `displayPattern` — stored by the editor; not used by the current frontend
  rendering.

## Prerequisites

Events in Fair Events; days without events render empty. The week starts on
the site's "Week Starts On" setting.

## Rendering

Renders `.wp-block-fair-events-events-calendar` with the month grid. The block
`anchor`, or `fair-events-calendar` by default, is used as the scroll target
after navigation.
