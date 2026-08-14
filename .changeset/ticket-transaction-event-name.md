---
"fair-events": patch
---

Ticket purchase transaction descriptions now use the event's name (e.g. "Ticket for Dance connection") instead of its raw numeric ID (e.g. "Ticket for event #43"), matching the format other transaction types already use. Applies to both single-occurrence and recurring/multi-instance signups; falls back to the previous numeric format for event dates with no linked post. Existing transactions are unaffected.
