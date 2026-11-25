---
'fair-events': minor
---

Add a complete campaign facts endpoint, `GET /fair-events/v1/event-dates/{id}/campaign-facts/complete`, for users who can edit posts and can edit the event's page (the series page for a generated occurrence). In one consistent database snapshot, it returns an occurrence's event and venue facts, its programme with resolved titles, shifted local times and bookability, contributors, promotional profiles, and ordered images with focal regions, in the Event Content Studio campaign-facts v1 shape. Teaching languages are always null. Turned-off features, missing records, broken references and failed reads are returned as distinct errors, never as empty results. Contacts, credentials, attendee data and joining links are never included.
