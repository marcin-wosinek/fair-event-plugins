---
'fair-finance': patch
---

Saving a split in the split editor now updates its existing allocations in place instead of recreating them, so each allocation keeps its ID, tag (including an intentionally untagged one) and settlement reconciliation identity. Recalculating a settlement split also recognizes allocations an earlier split save recreated, when each one still has a unique amount and description, and lists them in the preview.
