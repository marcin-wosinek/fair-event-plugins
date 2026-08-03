---
"fair-payments-connector": major
---

Remove Mollie API key authentication in favour of the guided OAuth connection. Stored test/live API keys are deleted on upgrade and are no longer accepted through the settings API; a site that only had a key (no guided connection) sees a one-off notice explaining that it needs to reconnect Mollie, and stops being able to take payments until it does.
