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
