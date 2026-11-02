---
'fair-events': minor
---

Prefill Meetup events in “From URL”: when a Meetup event page lacks complete schema.org data, the title, start and end times (converted to the site timezone) and venue name are read from the page's embedded event data. A lookup that finds no start time now leaves the time fields empty instead of showing the default 10:00–12:00.
