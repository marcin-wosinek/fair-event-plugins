---
"fair-events": patch
---

Fix the standalone get-tickets block (used when fair-audience is inactive) rendering an empty form for a specific occurrence of a recurring event. Ticket types, sale periods, and prices now resolve against the series master's configuration while the signup itself stays linked to the specific occurrence, mirroring the pivot fair-audience's event-signup block already does.
