---
"fair-events": patch
---

Fix the event Finance tab double-counting income: Total Income now comes only from paid transactions instead of also adding fair-finance entries, which could duplicate the same money when an entry wasn't explicitly reconciliation-matched. The entries table is now cost-only, and the Payments table shows each transaction's linked budget entry (if any).
