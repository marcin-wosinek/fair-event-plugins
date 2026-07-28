---
"fair-payments-connector": patch
---

Reject a payment request whose `block_id` is empty instead of matching it against any legacy simple-payment block with the same blank saved id — closes a mischarge risk on pages with more than one such block. The block editor also now warns with a save prompt when a simple-payment block is missing its id, since the id is only fixed in the published post once it's re-saved.
