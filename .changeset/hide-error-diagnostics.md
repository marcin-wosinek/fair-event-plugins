---
'fair-payments-connector': patch
---

Failed connection tests and Mollie webhooks no longer reveal server file paths or internal error details. The connection test shows the technical details only when WP_DEBUG is on, and the full webhook error stays in the payment log.
