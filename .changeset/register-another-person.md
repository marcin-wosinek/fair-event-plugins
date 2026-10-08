---
"fair-events": minor
"fair-audience": minor
---

Let a returning participant register another person. A participant the browser remembers who already holds a ticket for an event date now finds "Register another person" below their tickets. It opens an empty signup form headed "Registering another person": no name, email, ticket choice, activities or answers are carried over, the other person's ticket types and prices are their own (no member discount or members-only ticket), and their signup, tickets and payment are recorded under their own name. The participant's own ticket and the browser's memory of them stay as they were: "Back to your ticket", completing a free registration, or reloading the page shows their ticket again; a paid registration ends on the usual payment confirmation.

The action is not offered to someone who opened a personal signup link or is signed in to the site. "Buy another ticket for yourself" and "Not you? Start fresh" keep working as before. If the email entered for the other person already belongs to a participant, they get the usual link by email to continue.

For developers: `POST fair-events/v1/get-tickets` and `GET fair-events/v1/get-tickets/viewer-context` accept `register_another_person` (400 `register_another_person_unavailable` together with a participant token or a signed-in account). Every signup hook that passes `$participant_token` now also passes a trailing `$request_context` array (`register_another_person`); see REST_API_BACKEND.md.
