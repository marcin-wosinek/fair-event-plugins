---
'fair-payments-connector-experimental': patch
---

Fix daily, hourly and weekly sales digest emails never being delivered. The notification queue table was never created because its upgrade hook was registered too late to run, so every queued sale was silently dropped. The table is now created on `init`, each digest frequency has its own recurring event, and a digest is only marked sent once the channel reports success. A failed send keeps the sales queued with the attempt count and a sanitized error, an interrupted run is recovered after 30 minutes, and overlapping runs cannot send the same sale twice. Rows queued before this release keep their route's frequency.
