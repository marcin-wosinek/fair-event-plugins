---
'fair-events': patch
---

Prepare ticket purchases for Fair Events owning their payment history. Once the payment history cutover is activated (in a later release), each checkout and payment retry records its payment before the buyer pays, and a payment completed for an earlier attempt still confirms the purchase. Payment notifications that arrive twice or out of order confirm once, and a confirmation interrupted before its email is sent is finished later. Nothing changes until the cutover is activated.
