---
'fair-payment': minor
---

Add payment error logging. New `PaymentLog` model with database schema, REST endpoint, and admin log viewer on the transaction page. Mollie webhook and payment endpoints record errors for troubleshooting.
