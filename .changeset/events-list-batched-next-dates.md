---
'fair-events': patch
---

Events List: Query Loop layouts load the next date of every listed event together instead of one event at a time, so a list no longer adds two database queries per event.
