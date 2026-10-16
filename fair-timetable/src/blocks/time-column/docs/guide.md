## Purpose

One vertical lane of a timetable: a stage, a room, a teacher, or a day. It
shows a title above a body that holds the lane's time slots.

## Composition

- **Parent:** must be a direct child of `fair-timetable/timetable`.
- **Children (locked template):** exactly a `core/heading` (level 2, the
  column title) followed by one `fair-timetable/time-column-body`. Authors
  edit the heading text; they cannot add, remove, or reorder these children.
  Content generated outside the editor must keep the same two children in the
  same order, or the editor reports a template mismatch.

## Attributes

None of its own. The column reads the timetable's `fair-timetable/startTime`,
`fair-timetable/endTime`, and `fair-timetable/hourHeight` context and exposes
them as CSS custom properties (`--context-start-time`, `--context-end-time`,
`--context-hour-height`) for its slots.

## Prerequisites

Only Fair Timetable. No site records are referenced.

## Rendering

Renders the saved column with the context custom properties on its wrapper.
Columns are laid out side by side by the timetable's stylesheet.
