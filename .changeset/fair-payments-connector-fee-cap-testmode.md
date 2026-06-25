---
"fair-payments-connector": minor
---

Cap the 1 % application fee at the operator's monthly allowance: once the cap is reached, the fee drops to zero for the remainder of the month.

Fix testmode payments: Mollie PHP SDK v3 reads `testmode` from the third argument of `payments->create()`, not from the payload body. Placing it in the payload was silently ignored, causing every payment to be created live regardless of the `fair_payment_mode` setting.
