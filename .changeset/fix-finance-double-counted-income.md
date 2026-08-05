---
"fair-events": patch
---

Fix the event Finance tab counting income twice when a bank-statement entry has been reconciliation-matched to a payment transaction: matched financial entries are now excluded from totals, so only the transaction's gross amount is counted.
