---
'fair-events': patch
---

Calendar: link each recurring instance to its own date

Per-occurrence URLs now include `?event_date={id}` in the events-calendar block,
the weekly-schedule block, and the public events REST API, so visitors land on
the specific instance rather than the bare event permalink. The admin calendar
distinguishes generated recurring instances visually (own icon and color) instead
of styling them like unlinked events.
