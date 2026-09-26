---
'fair-events': patch
---

Fix ticket purchases made through the Event Signup block leaving the payment transaction without its event. New transactions now link to the purchased event, or to the series' own event for recurring purchases, so transaction views show the event title instead of a blank. This also applies to optional activities bought with the ticket and to retried payments. Existing transactions are not backfilled.
