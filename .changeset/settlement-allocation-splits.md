---
'fair-finance': minor
---

Split reconciled bank entries the same way from every starting point. Saved-settlement review, the bank-transfer screen and legacy CSV review now share one allocation planner: supported splits are part of full confirmation, settlement-level fees and adjustments become explicit signed allocations, refunds stay signed allocations of their payment, and a split is only created when its amounts sum exactly to the bank entry. Both review screens preview the proposed allocations with their amounts, event links and budgets, explain when no split is created, and a fully reconciled settlement whose bank entry was never split can apply its missing split without releasing the association.
