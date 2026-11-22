---
'fair-events': minor
---

Add a campaign facts endpoint, `GET /fair-events/v1/event-dates/{id}/campaign-facts`, for users who can edit posts. It returns one occurrence's title, statuses, attendance mode, timing with the site timezone, its own page URL and its venue in the Event Content Studio campaign-facts v1 shape. Content language and booking URL are always null for now. Joining links are never included, and missing or unreadable source data is returned as an error, never as an empty value.
