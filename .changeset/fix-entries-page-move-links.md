---
"fair-finance": patch
"fair-payments-connector": patch
---

Fixed broken links left over from the Budgets/Entries/Reconciliation screens' move from Payments Connector into Finance: the budgets list's "View" links (for a specific budget and for unbudgeted entries) now point at the current `fair-finance-entries` admin page instead of the retired, unregistered slug that produced a permissions-denied page. The transactions list's entry column, whose deep link into a specific entry never actually worked, now shows the entry ids as plain text instead of a dead link.
