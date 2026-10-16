## Purpose

The slot container of a time column. It owns the vertical time axis of the
column: its slots are absolutely positioned against it using their start time
relative to the timetable's start time.

## Composition

- **Parent:** must be a direct child of `fair-timetable/time-column` (and is
  placed there automatically by the column's locked template).
- **Children:** only `fair-timetable/time-slot` blocks, in any number. The
  editor offers a button that appends a slot starting where the last one ends.
  When the body is empty the editor seeds one slot.

## Attributes

None of its own. It consumes the timetable context
(`fair-timetable/startTime`, `fair-timetable/endTime`,
`fair-timetable/hourHeight`) to size the axis.

## Prerequisites

Only Fair Timetable.

## Rendering

Wraps the saved slots in a `time-column-body-container` element. Order of the
slot blocks does not affect their visual position; their times do.
