---
"fair-payments-connector": minor
---

Add a one-click "Create test payment" button on the connector settings connection tab to exercise the full payment flow without building a page, show the connected Mollie profile name and enabled methods on that tab, and link out to the org-specific Mollie payment methods page instead of the generic dashboard root. Sanitize Mollie's raw gateway error responses before they reach visitors, showing everyone a generic message while a capability-checked admin also gets an interpreted cause and fix-it links, with full detail still going to the payment log. Fix a 403 fetching the Mollie profile under an org-level OAuth token, reword the test-payment description in plain language, and standardize the Simple Payment block's button on core Button styles.
