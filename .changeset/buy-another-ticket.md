---
"fair-events": minor
"fair-audience": minor
---

Let a recognised participant buy another ticket for themselves. A participant who already holds a ticket for an event date now sees their tickets — each with its own ticket type and activities — and, right below, the signup form headed "Buy another ticket for yourself" with their name and email. Their identity, discounts and access to restricted tickets are kept, nothing from the earlier ticket is carried into the new purchase, and "Not you? Start fresh" stays a separate way to continue as someone else. Dates already held are marked in the date pickers and can be chosen again. Each purchase keeps its own signup, tickets and payment, and ticket and activity limits apply as for any other purchase.

After a purchase, the form gives way to a "Back to the signup form" link, which shows the tickets now held and a fresh form; the payment confirmation page offers the same link and lists the tickets of the purchase just paid for. Confirmation emails for free signups now list the activities chosen with that purchase.

"Cancel signup" is no longer offered to participants whose signup has tickets, and the request is refused: it removed the participant from the event together with every ticket they hold. It is still available for signups without tickets, such as those added by an organizer. Cancelling a single ticket is done by an organizer from Manage Event.

For developers: the signed-up card moved from `fair_events_signup_render_before_form` to the new `fair_events_signup_render_existing_signup` action, returned as `existing_signup_html` by `GET fair-events/v1/get-tickets/viewer-context` and placed before the form; `suppress_form` is no longer set for a signed-up viewer. `DELETE fair-audience/v1/event-signup` answers 409 `signup_has_tickets` for a ticket-backed signup. The payment-state response gained `tickets`.
