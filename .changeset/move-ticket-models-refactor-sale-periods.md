---
"fair-events": minor
"fair-events-experimental": minor
---

Move TicketSalePeriod, TicketType, and TicketPrice models from fair-events-experimental into fair-events (namespace FairEvents\Models), and refactor sale periods to half-open day ranges [sale_start, sale_end) in the site timezone with two seeded defaults (before / during the event).
