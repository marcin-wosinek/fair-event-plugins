---
'fair-events': minor
---

Event statistics can show sales history further back. A "Sales history" choice above the cumulative ticket and sales amount charts starts both charts 30, 60, 90 or 180 days before the event; the default is 30 days, three more than the 27 days shown before.

- Both charts update together, and sales before the chosen period still count toward the starting totals. Each chart names its period under its title, so a downloaded PNG shows which period it covers.
- While a new period loads, the charts show a spinner and cannot be downloaded. If loading fails, a notice offers to try again.
- The statistics REST endpoint accepts an optional `history_days` parameter (30, 60, 90 or 180; default 30) and reports the length it used as `history_days`.
