---
"fair-events": patch
---

Fix linking/unlinking a page from a recurring event sometimes only applying to one date in the series instead of the whole series, by making the "which event is this page linked to" lookup always resolve through the series' primary date.
