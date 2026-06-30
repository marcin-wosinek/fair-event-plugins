---
"fair-events": minor
"fair-audience": patch
---

Add manual disable/enable for sold ticket types: a new `disabled` boolean column on ticket types lets admins hide a type from the signup form without deleting it. The admin UI replaces the Remove button with an Enable/Disable toggle when the type has sales. The server guards against deleting sold types omitted from the payload (defense in depth). The event-signup block and the GetTickets gate both respect the flag.
