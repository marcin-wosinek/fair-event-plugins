---
'fair-events': patch
---

The payment history migration check no longer blocks on a paid purchase that an organizer moved to another date. Its old record kept the payment on the original date while the new one counts it once on the purchase's current date; the report now shows this as "Purchase moved to another date". Any other difference still blocks.
