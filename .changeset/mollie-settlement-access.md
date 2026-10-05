---
'fair-payments-connector': minor
'fair-finance': minor
'fair-platform': minor
---

Request Mollie settlement access when Fair Finance is active. Connecting to Mollie asks for the same permissions as before, plus permission to read settlements on sites running Fair Finance. The site records the permissions Mollie actually granted and treats settlement access as available only when that permission was granted.

A site connected before this change keeps accepting payments. Its connection settings now offer **Reconnect**, which goes through the Mollie authorization again without disconnecting first, and Fair Finance's Reconciliation page explains when settlement access still needs to be authorized and links there. Cancelling or failing an authorization leaves the existing connection as it was and says so, instead of ending on an error page.
