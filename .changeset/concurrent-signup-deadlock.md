---
'fair-events': patch
---

Fix signups failing with "Failed to save signup" when two people signed up at the same moment. Saving a new signup's tickets no longer locks rows the other signup needs, so simultaneous purchases both go through.
