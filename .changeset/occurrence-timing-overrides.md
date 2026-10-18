---
'fair-events': minor
---

Recurring events and copies now work without a start or end time. Every
date of a series keeps the series' day span and times, and a missing time
stays missing. A copy moves its dates by whole days and never invents a
time. A date of a series that you edit on its own now keeps its dates or
times when the series changes later. Moving one date or changing its times
no longer gets undone by the next series edit, and a cleared time stays
cleared. The `fair-events/v1/event-dates` API reports these with
`timing_overrides`, resets them with `inherit_timing`, and refuses with 409
a series change that an edited date cannot follow. Existing edited dates
are detected on upgrade. Copying a series also copies the timing of dates
edited on their own.
