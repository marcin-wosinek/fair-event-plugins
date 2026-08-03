---
"fair-events-shared": minor
"fair-events": minor
---

Send a payment-failed email (event name, plain link back to the event page) from the standalone Event Signup block when a payment fails, is rejected, cancelled, or expires — mirroring fair-audience's own failed-payment email so buyers on fair-audience-free sites get the same notice. The shared `SignupConfirmationEmail` formatter gains an optional plain action link, reused for this new email.
