---
"fair-payments-connector": minor
"fair-events": patch
---

The integration fee becomes a flat 2% of ticket sales with no monthly cap. It stays waived for transactions created before 1 January 2027 (midnight in the site timezone); from then on, each new transaction records a 2% fee. Fees already recorded on existing or imported transactions are never recalculated, and Mollie's processing fees remain separate.

The Fee Dashboard now explains the new pricing and shows only this month's payment volume and integration fees. The monthly cap meter, remaining allowance, and active-plan breakdown are gone, and the `/fair-payments-connector/v1/dashboard/monthly-summary` response no longer includes `fee_cap`, `cap_remaining`, or `plan_breakdown`. The `fair_payment_active_plugin_prices` filter has been removed. Pricing copy in both plugin readmes is updated to match.
