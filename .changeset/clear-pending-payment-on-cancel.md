---
"fair-audience": patch
---

Fix "Cancel and start over" leaving the participant's `pending_payment` row in place, which let render.php's DB-fallback resurrect the same stuck checkout on the next page load. The delete event-signup endpoint now accepts `pending_payment` (not just `signed_up`), and the frontend calls it before navigating to the stripped URL.
