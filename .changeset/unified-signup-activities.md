---
"fair-events": minor
"fair-audience": minor
---

The unified Event Signup form (used once fair-audience owns the flow, #1245) now supports selectable activities (ticket options): a participant can pick zero or more paid or free add-on activities at signup, subject to a minimum-activities requirement (global or raised by the selected ticket type), and a signed-up participant can add further activities to an existing registration. Capacity, pricing, and group discounts are all enforced server-side, so a crafted request can't buy a full activity, skip the minimum, or dodge the charge.
