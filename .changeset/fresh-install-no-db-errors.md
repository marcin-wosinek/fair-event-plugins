---
'fair-events': patch
---

Activating Fair Events on a site that never had it no longer logs database
errors: a fresh install creates the current tables directly instead of
running upgrade steps against tables that do not exist yet.
