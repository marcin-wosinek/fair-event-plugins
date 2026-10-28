---
'fair-events': patch
---

The Finance tab in Manage Event now appears whenever Fair Payments Connector is active, so administrators can see an event's payments without installing Fair Finance.

- With only Fair Payments Connector, the tab shows the event's total income and net, its payments and failed payments, and "No payments for this event yet." when there are none. Costs, balance, budgets and accounting-entry links are left out.
- With only Fair Finance, the tab shows the budget, costs and accounting entries, without income, net or balance.
- With both plugins, the tab works as before.
- Payments and costs load separately: if one cannot be loaded, the tab says which one and still shows the other, instead of failing as a whole or showing a zero total.
