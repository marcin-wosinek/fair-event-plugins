---
"fair-payments-connector": patch
---

Fix a mischarge bug where duplicating a Simple Payment block copied its hidden identifier along with it: the editor now reassigns a fresh identifier to the duplicate and warns the owner to save, and the payment endpoint rejects a payment when the submitted identifier matches more than one saved block instead of trusting the first match.
