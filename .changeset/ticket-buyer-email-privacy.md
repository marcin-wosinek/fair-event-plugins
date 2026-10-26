---
'fair-payments-connector': minor
---

A new Privacy tab in payment settings controls whether Fair Events ticket payments send the buyer's email to the payment provider.

- When it is off, new ticket payments, including retries, leave the email out of the payment metadata sent to Mollie. Transaction, event and signup references are still sent, and the email stays stored locally for registrations, participant matching and confirmation messages.
- The choice applies to payment attempts made after it changes; it does not change data a provider already holds. Each change is recorded in the audit log.
- New sites start with it off. Sites whose existing ticket payments already included buyer emails keep sending them until an administrator turns it off.
