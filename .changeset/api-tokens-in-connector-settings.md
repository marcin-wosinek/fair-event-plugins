---
'fair-payments-connector': minor
'fair-payments-connector-experimental': minor
---

API tokens now come with Fair Payments Connector, so a site no longer needs Fair Payments Connector Experimental to share its transactions with other sites. Tokens are managed on a new **API Tokens** tab under Fair Payments Connector → Settings: generate a token, copy it while it is shown once, see when each token was last used, and revoke it after a confirmation that names the token. The tab and its dialogs work on phone-sized screens, and the Settings tabs wrap instead of squeezing.

Existing tokens keep working and nothing has to be re-entered. The data sharing API keeps its addresses, responses and error codes, so sites that already import from this one need no change. New tokens can only read transactions: the unused "Read locations" permission is no longer offered, and a request for it is refused. An older token that still lists it keeps its transaction access and gains nothing else.

Fair Payments Connector Experimental no longer has its own API Tokens page and is now only about Connected Sites, which work as before. The two plugins can be updated in either order: an older Fair Payments Connector Experimental keeps serving API tokens until it is updated, and an updated one keeps serving them for an older Fair Payments Connector, so there is always exactly one place to manage tokens.
