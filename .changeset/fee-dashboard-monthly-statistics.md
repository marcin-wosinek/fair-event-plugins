---
"fair-payments-connector": minor
---

The Fee Dashboard is now a monthly statistics page. Organizers can move between months and see paid transaction count, total paid, recorded Fair Event commission, recorded Mollie commission, and a calculated amount after fees, shown separately for each currency. Figures are marked incomplete, with a count of affected transactions, while Mollie fee data or a Fair Event commission is still missing, and they update when fees arrive later. Only paid transactions count, in the month they were created (UTC). The `/fair-payments-connector/v1/dashboard/monthly-summary` endpoint accepts an optional `month` (`YYYY-MM`) and now returns a `currencies` array instead of `total_volume` and `total_fees`. Pending transactions no longer add to the integration-fee total.
