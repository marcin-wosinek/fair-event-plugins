---
"fair-events": minor
"fair-events-shared": minor
---

The unified Event Signup form (used when fair-audience is inactive) now shows a rich outcome when a visitor returns from paying: a confirmed card (event, amount, "confirmation email on its way"), a processing card that polls and updates in place, or a resume/retry card for a failed, canceled, expired, or abandoned payment — with buttons to continue the existing checkout, retry with a new one, or cancel and start over. A visitor who navigates directly back to the event page (no return link followed) now also sees their in-progress payment, recognised via a short-lived signed cookie, within the 15-minute hold window. Payment status is reconciled with the payment provider on return so the page never misreports a payment mid-redirect. When online payments are unavailable, ticket sales still show the existing "temporarily unavailable" notice instead of a dead retry button.
