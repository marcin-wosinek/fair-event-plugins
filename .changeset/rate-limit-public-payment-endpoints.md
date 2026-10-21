---
'fair-payments-connector': patch
---

The public payment endpoints are now rate limited per visitor IP address, so a script can no longer create unlimited payments in your Mollie account or flood the payment log. Each limit has its own one-minute window, and a request over the limit gets a "Too many requests" answer (HTTP 429) saying how many seconds to wait.

- **Starting a payment** (Simple Payment block): 10 attempts a minute.
- **Loading the payment form's security token:** 60 requests a minute.
- **Mollie webhook calls with a missing, malformed or unknown payment ID:** 30 a minute. Webhooks for real payments are never limited, and unknown IDs never reach Mollie. Once the limit is reached, further bogus calls are no longer written to the payment log.

Visitors who share an address (an office network or a mobile carrier) share these limits. If your site runs behind a reverse proxy or CDN, make sure the web server passes the real visitor address; otherwise every visitor counts as the proxy.
