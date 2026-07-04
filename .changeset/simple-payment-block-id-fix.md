---
"fair-payments-connector": patch
---

Fix the simple-payment block rejecting every purchase with "Block not found." Since the block-id/amount verification was added to the payment endpoint, render.php overwrote the saved blockId attribute with a per-render `wp_unique_id()` before printing the button's `data-block-id`, so the submitted id could never match the block in post content and the endpoint returned 403. The unique id is now used only for the wrapper's DOM id; the button submits the real blockId attribute. Caught by the new simple-payment e2e spec — the API specs only covered the rejection paths.
