---
'fair-audience': minor
---

Robust Mollie payment retry flow and signup identity handling. Resume links in payment-failure emails, a "Continue payment" UI for open Mollie status, recovery after cookie expiry, and preserved ticket selection across retries. Signup identity now prefers the logged-in WP user over the session cookie, with a 1-hour pre-fill cookie and a "start fresh" escape hatch. Ticket quantity limits are enforced.
