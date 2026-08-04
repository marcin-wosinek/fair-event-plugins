---
"fair-events": patch
"fair-audience": patch
---

Fix the Event Signup form leaking one visitor's group-restricted ticket tiers, discounted prices, and name/email pre-fill to another visitor under full-page caching. The form now server-renders the same unrestricted, undiscounted, unfilled markup for every viewer, and fetches the actual viewer's personalization (restricted tiers, discounts, pre-fill, signed-up state) client-side after load.
