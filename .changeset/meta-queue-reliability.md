---
'fair-events-experimental': patch
---

Queued checkout and purchase events reach Meta more reliably.

- A new checkout or purchase is sent right away instead of waiting behind a retry scheduled for later.
- When background delivery cannot be scheduled, the Meta page shows a warning with the time of the last failure. Later site visits try again, and queued events are sent once scheduling works. Payments are not affected.
- Events whose delivery was interrupted, for example by a server timeout, are sent again after five minutes under the same Meta event ID. An interrupted attempt counts toward the existing limit of six attempts.
- Each background run sends at most 20 events and stops early enough to finish within about 20 seconds. Remaining events are scheduled for the next run.
