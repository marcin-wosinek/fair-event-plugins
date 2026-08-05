---
"fair-events": patch
---

Fix the Event Signup form listing ticket types with no pricing for the currently active sale period — they now stay out of the list entirely instead of showing unpriced and selectable. When no sale period is active at all, the ticket-type section is hidden and signup is treated as temporarily unavailable, matching the existing payments-unavailable treatment. The get-tickets purchase endpoint also now rejects an out-of-window ticket type with a 409 error instead of silently charging 0.
