## Purpose

The outer container of a visual schedule. A timetable lays out one or more
**time columns** (stages, rooms, days) side by side on a shared vertical time
grid, and each column holds **time slots** positioned by their start and end
times.

## Composition

The structure is fixed and every level is required:

```
fair-timetable/timetable
└── fair-timetable/time-column            (one or more; the only allowed child)
    ├── core/heading (level 2)            (column title)
    └── fair-timetable/time-column-body   (exactly one)
        └── fair-timetable/time-slot      (zero or more)
            └── core/heading, core/paragraph, core/list, core/group
```

The editor inserts three columns when a timetable is added. A time column's
heading + body template is locked: authors edit the heading text but cannot
add, remove, or reorder the column's direct children.

## Attributes

- `startTime` / `endTime` — the visible range of the grid, as `HH:MM` 24-hour
  strings. A range whose end is earlier than its start is treated as running
  past midnight.
- `hourHeight` — the height of one hour, in `em`-like units consumed by the
  CSS custom property `--hour-height`. Larger values make short slots more
  readable.

These three values are passed to every descendant as block context
(`fair-timetable/startTime`, `fair-timetable/endTime`,
`fair-timetable/hourHeight`), so columns and slots must stay inside a timetable
to be positioned.

## Prerequisites

None beyond Fair Timetable being active. The block does not read events or
any other site records; all content is authored in the post.

## Rendering

The saved markup is static HTML, and `render.php` re-wraps it with CSS custom
properties (`--hour-height`, `--column-length`) computed from the attributes.
Slots outside the grid's range are still rendered but positioned outside the
visible area, so keep slot times within `startTime`–`endTime`.

## Authoring notes

Markup inside each block comment must match what the editor saves; the
examples were produced by the editor and are safe to copy. When generating
content, change attribute values and inner text, not the wrapper `div`s or
their classes.
