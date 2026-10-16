## Purpose

One scheduled item in a timetable column — a class, a talk, a break. Its
height and vertical position come from its start and end times.

## Composition

- **Parent:** must be a direct child of `fair-timetable/time-column-body`.
- **Children:** free content limited to `core/heading`, `core/paragraph`,
  `core/list`, and `core/group`. New slots start with a level-3 heading.

## Attributes

- `startTime` / `endTime` — `HH:MM` 24-hour strings. The slot's offset is
  computed from the timetable's `fair-timetable/startTime` context, and its
  length from the difference between the two times (an end before the start
  counts as crossing midnight).
- Background and text colors are available through block supports
  (`backgroundColor`, `textColor`, or `style.color`).

## Prerequisites

Only Fair Timetable. The slot does not link to Fair Events records; type the
title and description into the inner blocks.

## Rendering

Renders the saved content preceded by an `h4.time-annotation` showing
`start-end` (for example `10:00-11:30`), with `--time-slot-length` and
`--time-slot-time-from-start` custom properties on the wrapper.
