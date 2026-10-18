---
'fair-payments-connector': minor
'fair-platform': minor
---

Upgrade the Mollie PHP SDK to v4. Both plugins now require PHP 8.2 or newer; update the server's PHP version before installing this release. Payments, webhooks, refunds shown on transactions, the Mollie connection and existing transactions and settlements work as before. Settlement imports now stop with a clear error, instead of finishing early or looping, when Mollie returns a next-page link that cannot be followed, a page cursor that was already loaded, or a report that cannot be read; continuing such an import never skips or repeats movements. A movement page that cannot be saved is retried on the next step instead of being skipped. Provider outages and unreadable Mollie responses during checkout, payment sync and payment import are reported as controlled errors.
