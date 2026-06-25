---
"fair-audience": minor
"fair-payments-connector": patch
---

Block paid-event signup when the payment connector is not configured. Previously `maybe_start_paid_signup()` and `maybe_start_addon_payment()` fell through to the free path whenever the resolved total reached zero — which happened when the EventSignupPricing service was unavailable or unconfigured, silently granting free access to paid events.

Adds `TransactionAPI::is_configured()` (delegating to `MolliePaymentHandler::is_configured()`) and `EventSignupPricing::has_paid_price_configured()` so both conditions are checked before allowing a zero-total signup to proceed.
