---
"fair-events": patch
---

Fix iCal feed import storing the wrong time of day for timed events whose source timezone differs from the site timezone (`DateHelper::datetime_to_local()` never converted, since Sabre's iCal parser returns `DateTimeImmutable`, not `DateTime`). Also fix floating/all-day iCal values being interpreted through UTC instead of directly as site-local, which could shift an all-day event's civil date by a day on negative-offset site timezones.
