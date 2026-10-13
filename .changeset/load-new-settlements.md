---
'fair-payments-connector': minor
'fair-finance': minor
---

Loading Mollie settlements now starts with **Load new**: it brings in only
the settlements that are not saved yet and leaves the ones already loaded
from Mollie unchanged, saying so when nothing new was found. **Reload all**
stays available as the lesser action for retrieving every settlement again.

An import that failed or was interrupted can be continued or replaced by
another import. After a failed request the page reads the import back from
the server instead of leaving its buttons disabled, and an import the server
still counts as running is shown as such with a way to refresh its status.

While Fair Finance is active, the External Updates page of Fair Payments
Connector has a **Mollie settlements** section that loads new settlements
and continues an import left unfinished on either page. Settlement imports
appear in its operation log, one entry per import.
