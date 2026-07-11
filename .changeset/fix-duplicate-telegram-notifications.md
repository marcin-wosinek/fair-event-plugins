---
"fair-payments-connector": patch
---

Fix duplicate Telegram payment notifications when a Mollie webhook and the page-load status sync raced to mark the same transaction paid. `Transaction::update_status()` now performs a compare-and-swap update against an expected prior status, so only the caller that wins the race fires the `fair_payment_paid` hook.
