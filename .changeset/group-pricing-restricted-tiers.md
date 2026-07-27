---
"fair-events": minor
"fair-audience": minor
---

The unified Event Signup form (used once fair-audience owns the flow, #1245) now respects group-restricted ticket types and group discount pricing: a ticket type restricted to specific groups is rejected server-side for a visitor who isn't a member, and the charged price reflects the viewer's best-matching group discount, with a note shown above the submit button. Entitlement is resolved from the signed-in/known viewer's session, never from the submitted name/email, so a crafted request can't unlock a restricted tier or a discount it isn't entitled to.
