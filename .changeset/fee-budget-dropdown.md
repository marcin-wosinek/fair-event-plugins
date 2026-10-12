---
'fair-audience-experimental': patch
---

Fix the Budget dropdown in the Create Fee dialog, which only offered "No
Budget". It now lists the budgets kept in Fair Finance, reloaded each time the
dialog opens, so a budget added a moment ago can be picked without refreshing
the page. While budgets load the dialog says so; when there are none, or when
they cannot be loaded, it says which — a failed load comes with a Retry button
and the fee can still be created without a budget. The transfer dialog on Fee
Detail reads budgets the same way, and Fee Detail now shows the budget a fee is
linked to.

Sites where Fair Finance was never installed can list and open membership fees
again: a fee keeps the budget it was linked to, and its budget name is simply
left empty.

Creating a transfer from a pending payment on Fee Detail works again: it was
sent to an address that no longer exists, so the transfer was never created
and the payment stayed pending. A transfer that cannot be created now says
why inside the dialog and keeps what was entered. If the transfer is created
but the payment cannot be marked as paid, the page says so, so the transfer
is not created a second time.
