---
'fair-events': patch
---

Saving a schedule now fires `fair_events_schedule_item_deleted` for each entry it removes, so companion plugins can drop their links to it.
