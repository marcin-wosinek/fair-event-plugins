---
"fair-events": patch
"fair-calendar-button": patch
"fair-events-experimental": patch
---

Update the bundled calendar-link library from 2.11.4 to 2.11.6 and Recharts
from 3.10.0 to 3.10.1. Calendar exports and the statistics and comparison
charts show the same dates, values and tooltips as before.

The Fair Events calendar button now passes all-day events to the calendar
as plain dates, so they stay on their day in every timezone. Without this,
the updated library would have moved them one day later for visitors in
UTC+12 timezones, such as New Zealand in winter or Fiji.
