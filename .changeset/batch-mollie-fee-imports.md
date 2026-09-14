---
"fair-payments-connector": patch
---

Import missing Mollie transaction fee data in batches of 10 instead of one request per transaction, so large fee synchronizations are faster and less vulnerable to interrupted connections.
