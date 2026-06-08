---
"fair-payments-connector": major
---

Rename the `fair-payment` plugin to `fair-payments-connector`. WordPress.org review flagged "Fair Payment" as too generic; the new name positions it accurately as a connector to external payment providers and stays consistent with the `fair-*` family.

Renamed (code-level): directory `fair-payment/` → `fair-payments-connector/`, main file, plugin slug, text domain, REST namespace `/fair-payment/v1/` → `/fair-payments-connector/v1/`, PHP namespace `FairPayment` → `FairPaymentsConnector`, constants `FAIR_PAYMENT_*` → `FAIR_PAYMENTS_CONNECTOR_*`, init function, display name.

Preserved (to avoid destructive migrations / breaking existing content): block name `fair-payment/simple-payment`, all DB option keys (`fair_payment_*`), custom table names, post meta keys, and the `fair_payment_callback` URL parameter consumed by Mollie callbacks. Cross-plugin REST calls and PHP function references in sibling plugins are tracked in a separate ticket.
