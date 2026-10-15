---
"fair-finance": minor
"fair-payments-connector": minor
---

**Transactions** now link each matched financial entry reference to the Fair Finance **Financial Entries** screen, narrowed to that entry. This includes entries that are part of a split. The references are links only while Fair Finance is active; otherwise they stay plain text.

**Financial Entries** opened for a single entry shows "Showing entry #N" with a **Show all entries** action, hides the filters and tag chart, and limits the totals and CSV export to that entry. A split parent keeps its nested children and is counted once in the totals. A missing entry shows an explanation, and an invalid entry link shows an error instead of the full list.

`GET /fair-finance/v1/financial-entries` and `/financial-entries/totals` accept an optional `entry_id` (a positive integer). It takes precedence over the other filters.
