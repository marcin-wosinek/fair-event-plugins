---
'fair-events': minor
'fair-audience': minor
---

Fair Audience no longer records event payments in its own transaction ledger: Fair Events' payment history is the only record of which purchase a payment belongs to. New installations of Fair Audience no longer create the `fair_audience_event_participant_transactions` table. On existing sites the table and its rows stay untouched until the source-history cleanup removes them. Payments, retries, failed-payment emails, Statistics and participant payment history keep working as before. Update Fair Events and Fair Audience together.
