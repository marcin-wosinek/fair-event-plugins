---
"fair-payment": patch
---

Gate `/payments/{id}/status` with a per-transaction access token so transaction IDs cannot be enumerated. The token is generated at creation time, propagated through the Mollie redirect URL, and required for anonymous reads. Logged-in admins and the transaction's owner can still read without a token.
