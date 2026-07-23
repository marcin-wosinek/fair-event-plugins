---
"fair-audience": minor
---

Time out unconfirmed marketing subscriptions after a week (reverting them to minimal+confirmed and sweeping expired confirmation tokens), let subscribers opt out of just the weekly events summary independently of their other topic preferences, and show that weekly-summary opt-out on the participant detail page. Show the link source (domain or @handle) next to off-site event links in the weekly digest. Route every outgoing email through a single consent-enforcing method so marketing-consent checks can no longer be skipped by a new send path, sanitize payment gateway errors before they reach the event-signup form, and drop the redundant event_participants.transaction_id column in favor of the transaction ledger. Remove the Add-on collaborator discount ticket option and standardize remaining block buttons on core Button styles.
