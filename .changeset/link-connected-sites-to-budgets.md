---
"fair-payments-connector-experimental": minor
"fair-payments-connector": minor
"fair-finance": minor
---

Add an optional Budget selector to each Connected Site, so a transaction imported from that site retains a durable link to its local id. During reconciliation, an unmatched imported transaction now shows its source site's configured budget, and the administrator can review, change, or clear that proposal before confirming a match — an existing budget assignment is always preserved, and no budget is proposed when selected transactions resolve to different sites. Removing a Connected Site or its linked budget never breaks existing data; both simply resolve to no budget going forward.
