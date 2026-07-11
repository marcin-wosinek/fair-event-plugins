---
"fair-events": minor
---

Materialize cancelled recurring occurrences into real rows (new `status` and `recurrence_mode` columns) instead of a serialized exdates blob on the master, and switch inheritable instance fields (title, venue, address, link type, capacity, price) to NULL-means-inherit so an override is distinguishable from an inherited copy. Cancelling now soft-cancels instead of deleting, and a previously-cancelled occurrence restores to active if it reappears in the recurrence rule (issue #996).
