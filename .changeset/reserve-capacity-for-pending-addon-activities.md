---
"fair-audience": patch
---

Hold capacity for a paid activity while its add-on payment is in flight, instead of only counting it once payment confirms. Previously, two buyers could both pass the capacity check for the last spot on a capacity-limited activity because an in-progress add-on purchase wasn't reserved anywhere. An unpaid add-on selection also no longer appears as an already-granted activity on the signup form while its payment is still pending.
