---
"fair-events": patch
---

Fix `payment_expires_at` being parsed as local time in the Manage Event audience tab, which falsely flagged in-progress payment holds as expired on non-UTC browsers (e.g. CEST).
