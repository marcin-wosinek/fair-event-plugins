---
'fair-events': patch
---

Event pages' structured data (JSON-LD) now includes the cost of required extensions in each ticket type's advertised price. A ticket type that requires extensions advertises its price plus the cheapest valid choice of extensions for the same sale period, leaving out extensions that are full, not bookable on the schedule or not priced in that period. A ticket type whose required extensions cannot currently be chosen is no longer advertised, and an event is marked as free only when every advertised offer, extensions included, costs nothing. Signup prices, discounts and the prices shown on the page are unchanged.
