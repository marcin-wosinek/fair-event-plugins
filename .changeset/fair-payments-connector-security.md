---
"fair-payments-connector": patch
---

Security hardening: protect the payment endpoint with a block nonce and a server-side amount floor, restrict Mollie API keys to edit context in the REST API, and guard the webhook handler against terminal-state replays.
