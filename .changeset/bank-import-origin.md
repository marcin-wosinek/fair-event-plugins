---
'fair-finance': minor
---

Bank-imported entries keep their bank origin. The entry editor shows "Bank import" with the originating account, or "account unknown", instead of the "Paid from" selector, and the API refuses to record a bank import, or any of its split allocations, as event cash or personal funds. Descriptions, budgets, event links and tags stay editable. The import dialog can record which bank account the file comes from, and an account can be added there by name; existing imports stay without an account. Imports that were already recorded as event cash or personal funds keep that record, show a notice, and can still be edited otherwise.
