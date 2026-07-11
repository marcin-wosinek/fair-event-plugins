---
"fair-audience": minor
"fair-events": patch
---

Add a Move action on the Manage Event Audience tab to re-point a participant's signup to a sibling occurrence of a recurring event in one step, instead of deleting and re-adding and losing attendance state, admin comments, ticket options, and payment status (issue #954). Adds `GET /event-dates/{id}/siblings` to fair-events and `POST .../participants/{id}/move` to fair-audience.
