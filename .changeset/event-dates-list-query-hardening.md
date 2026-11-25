---
"fair-events": patch
---

Harden the admin event-dates list query: sorting is built from fixed SQL with bound column names, and rows that tie on the chosen sort column now keep a stable order across pages.
