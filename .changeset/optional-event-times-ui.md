---
'fair-events': minor
'fair-events-experimental': patch
'fair-events-shared': patch
---

Events can be created and edited with known dates and no times yet. In the
calendar's Add Event popup, Manage Event, the event details box and Copy
Event, each time is optional and can be added or cleared on its own; all day
stays an explicit choice. Invalid ranges are explained before saving, and a
missing time is never compared as midnight.

Every view shows only the times an event has: the admin calendar now places
date-only and partly timed events on their days (also when the browser is in
another timezone), the week view no longer shows "00:00" for a missing start,
and an end-only time reads as the end ("Ends 21:30, 15 October"). A date of a
series shows whether its times follow the series and can get them back. The
Add to calendar button explains, next to it, that both times are needed when
an event can't be exported.
