---
"fair-events": patch
---

Fix All Events showing the wrong time compared to Manage Event/DB. `start_datetime` is a naive site-local string that was being formatted with `dateI18n`'s default timezone handling, shifting the displayed time whenever the browser and site timezones differ. It's now tagged as UTC and rendered with `gmdateI18n` so the wall-clock value passes through unchanged.
