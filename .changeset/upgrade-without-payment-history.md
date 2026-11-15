---
'fair-events': patch
'fair-audience': patch
---

Start on existing sites that never had payment history. Fair Events now checks its own and Fair Audience's records and, when there are no payments, payment references, Fair Audience-only registrations, activity choices or migration records to move, starts without the payment history migration of Fair Events 2.2.0, with or without Fair Payments Connector. Sites with earlier payment history, or whose records can't be read, stay paused with the same upgrade instructions. Fair Audience follows Fair Events' decision even when Fair Events loads after it.
