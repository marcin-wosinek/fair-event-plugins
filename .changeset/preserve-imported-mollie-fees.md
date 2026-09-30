---
"fair-payments-connector": patch
"fair-payments-connector-experimental": patch
---

Re-importing transactions from a connected site or an export file no longer clears Mollie fees. A fee already recorded on the receiving site, including zero, is kept; an imported fee only fills a missing one. Connected sites now share each transaction's Mollie fee, and imports from older sites that do not send it still work. Fees lost to earlier imports can be recovered with **Load missing Mollie fees** under External Updates, as described in the plugin README.
