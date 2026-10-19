---
'fair-events': minor
---

Event dates can now be stored without a start or end time. The
`fair-events/v1/event-dates` API returns `start_date`, `end_date`,
`start_time` and `end_time`, and accepts them on create and update: a time
can be left out or cleared with `null` without becoming midnight or an
all-day event. Existing events are converted
on upgrade with their dates, times and all-day setting unchanged. The API now
rejects an end date before the start date and an end time before the start
time on the same day. Updating an event without sending `all_day` no longer
turns an all-day event into a timed one. For now, a recurring event still
needs a start time, plus an end time when it lasts several days, and an
event missing either cannot be copied yet.
