---
"fair-events": patch
"fair-audience": patch
---

Remove the seats-per-ticket capacity weighting feature. It let a ticket type consume more than one capacity slot, forcing every capacity query, signup projection, and participant snapshot to carry a per-row seat weight. Capacity math now collapses back to a plain row count; the Seats column/checkbox, the `seats_per_ticket` column, and the `seats` column on `event_participant` are dropped, with a forward migration for existing installs.
