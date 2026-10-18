---
'fair-events': minor
'fair-calendar-button': patch
---

Export events to calendars only when they are all-day or have both a start and an end time. The ICS feed leaves out dates with a missing time, and the calendar button offers no entry for them instead of guessing a time. On a recurring event that mixes both, the button adds the next date that has both times, without the series rule. The event dates and public events APIs report `calendar_export_eligible`, and the public events feed now includes `start_date`, `end_date`, `start_time` and `end_time`.
