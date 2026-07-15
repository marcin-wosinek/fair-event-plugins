---
"fair-events": minor
---

Add a unified event-signup block (aliasing get-tickets), a subscribe link on the events-calendar block, a public ICS calendar feed endpoint, irregular (hand-picked date) recurring series, a richer Quick Add Event modal (categories, linking, recurrence), and a redesigned Manage Event header. Fill in JSON-LD/OpenGraph event markup (offers, location, eventStatus, ItemList) across calendar and week blocks, and reflect the selected occurrence in that metadata and the admin bar. Simplify ticket setup to a single sale period by default and route event feeds through a consolidated EventFeedProvider pipeline. Fix the week block to honor all start-of-week days and stop manual/irregular series from dropping an edited master date.
