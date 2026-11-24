---
'fair-events': minor
---

Add a public campaign facts endpoint, `GET /fair-events/v1/event-dates/{id}/public-campaign-facts`, that anyone can read for a published event, including a published cancellation. It returns the occurrence's title, status, attendance mode, timing, its own page URL when that page is public and not password protected, and its venue's name, address and coordinates. Draft events answer like missing ones, and joining links, external display URLs, free-text addresses, venue social links and internal venue IDs are never included. The authenticated campaign facts endpoint is unchanged.
