---
'fair-audience-experimental': minor
---

Edit Fee now has the same Budget select as Create Fee, opened on the budget
the fee is linked to. Pick another budget to move the fee, or "No Budget" to
unlink it. A fee keeps its budget unless you change it — also when budgets
cannot be loaded, or when its budget is no longer in the list, in which case
the select still shows it.

While Fair Finance is not active, neither dialog shows the Budget select or
the notice about it any more; fees are created and edited without it and keep
the budget they already had.

The fees REST route now refuses a `budget_id` that is not a positive integer
or `null`, and an update clears the budget only when it is sent as `null`.
