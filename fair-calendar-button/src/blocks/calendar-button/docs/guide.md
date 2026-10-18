## Purpose

A button that lets visitors add an event to their calendar. Clicking it opens
a menu of calendar services (Google Calendar, Outlook, an `.ics` download,
and others), pre-filled with the event's time, title, link, description, and
location. It works on any post or page and does not need Fair Events.

## Composition

- Top-level block; it has no parent restriction.
- **Children:** one or more `core/button` blocks (the only allowed inner
  block). The editor starts with a single button labelled "Add to Calendar".
  The button's text and styles are authored on the inner `core/button`; its
  link (`url`) is ignored, because the menu replaces navigation.
- Layout is a flex row (justification and vertical alignment can be changed;
  orientation is fixed), and the block supports wide/full alignment and
  padding/margin.

## Attributes

- `start` / `end` — the event start and end. For timed events use local
  date-times without a timezone, `YYYY-MM-DDTHH:MM` (for example
  `2030-06-14T19:00`); visitors' calendars interpret them in the visitor's
  timezone. For all-day events use dates, `YYYY-MM-DD`.
- `allDay` — `true` for date-only events.
- `description` and `location` — free text copied into the calendar entry.
- `recurring` — `true` when the event repeats.
- `rRule` — the iCalendar recurrence rule used when `recurring` is true, for
  example `FREQ=WEEKLY;COUNT=6`, `FREQ=WEEKLY;INTERVAL=2;UNTIL=20301231`, or
  `FREQ=MONTHLY`. This is what the frontend reads.
- `recurrence` — the editor's own representation of the rule
  (`frequency`, `count`, `until`) used to rebuild its controls. Keep it
  consistent with `rRule` when generating content; the frontend ignores it.
- `syncWithEvent` — when the block is placed on a Fair Events event post
  (`fair_event`), the editor enables this and copies the event's start, end,
  all-day flag, and location into the attributes whenever they change in the
  editor. It has no effect elsewhere and no effect at render time: the saved
  attribute values are what visitors get.

The calendar entry's **title** and **link** are always the current post's
title and permalink; they are not attributes.

## Prerequisites

Only Fair Calendar Button. No site records are referenced. If the Plausible
Analytics plugin is active, clicks are tagged as a Plausible event.

## Rendering

The saved markup (a `wp-block-buttons` container with the inner button) is
re-wrapped server-side with `data-start`, `data-end`, `data-all-day`,
`data-description`, `data-location`, `data-recurring`, `data-rrule`,
`data-title`, and `data-url` attributes, which the frontend script reads to
build the menu. A timed event needs both `start` and `end`, and an all-day
event needs `start`: otherwise the button still renders, but clicking it
does nothing rather than adding an entry with a guessed time.

## Related

Fair Events registers an "Add to Calendar" variation of `core/button` that
reads dates from the event instead of attributes; see the Fair Events block
documentation (`core/button` variation `calendar-button`). When both plugins
are active, this block can be transformed into that variation.
