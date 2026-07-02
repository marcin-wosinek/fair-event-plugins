---
"fair-events": minor
"fair-audience": patch
---

Add recurrence scope for ticket types on recurring events: a ticket type can apply to a single occurrence or to `multiple_instances`. A scope-choice modal prompts the organizer when editing ticket types on a recurring event, the Ticket Prices table shows the active scope in parentheses, and sold ticket types are locked against scope changes. The event-signup block respects the resolved scope when listing available tickets.
