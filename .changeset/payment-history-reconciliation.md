---
'fair-events': minor
---

Add a Payment history page for administrators (Fair Events → Payment history). It runs the dry run and the migration of historical payment history, shows its progress, blockers and the verification report per event date, and lists every record the migration couldn't link automatically. From there an administrator can link a payment to the purchase it was for, split a shared payment between purchases, remove a link they added, or mark a record as reviewed. Each decision needs a note and is kept in an audit log with who made it and when. Nothing is charged, refunded or emailed, and existing payment records aren't changed.
