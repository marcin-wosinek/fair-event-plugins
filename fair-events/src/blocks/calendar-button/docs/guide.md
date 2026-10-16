## Purpose

An "Add to Calendar" button for event pages that needs no date entry: it is a
regular `core/button` marked with `isCalendarButton`, and Fair Events fills in
the event's start, end, all-day flag, recurrence rule, title, permalink,
excerpt, and venue (or address) when the page is rendered. Clicking it opens
the same calendar-service menu as Fair Calendar Button.

This is an extension of a core block, not a separate block type: it never
appears in `/wp/v2/block-types` under a Fair namespace. Discover it through
`variations` in Fair Events' `block-docs/index.json`.

## Composition

Use it like any button: inside `core/buttons`. Text, colors, and styles are
the button's own. Its `url` is ignored.

## Attributes

- `isCalendarButton` — `true` turns a `core/button` into a calendar button.
  Fair Events registers this attribute on `core/button` for every post type;
  the inserter variation is only offered on event post types.

## Prerequisites

- The post being rendered must be of a post type enabled for events and have
  a Fair Events event date. Otherwise the button renders as a plain link-less
  button.
- `?event_date=<YYYY-MM-DD>` selects one occurrence of a recurring event.
- Fair Calendar Button does **not** need to be active; Fair Events ships its
  own frontend script for this variation. When Fair Calendar Button is
  active, its block can be transformed into this variation.

## Rendering

The button's `a.wp-block-button__link` receives `data-calendar-button="true"`
plus `data-start`, `data-end`, `data-all-day`, `data-title`, `data-url`,
`data-location`, `data-description`, `data-recurring`, and `data-rrule`, and
the calendar menu script is enqueued.
