---
'fair-payments-connector-experimental': patch
---

Revoking an API token and removing a connected site now ask in a dialog instead of the browser's own prompt.

- Revoking names the token and the scopes sites lose, and explains that the token stays listed as revoked and cannot be reactivated.
- Removing a connected site names it and its address, says the stored token is deleted here but not revoked on the other site, and that transactions already imported from it are kept.
- A failure stays in the dialog so you can try again, and the action can't be sent twice while it runs.
