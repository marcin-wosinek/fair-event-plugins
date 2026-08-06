---
"fair-audience": patch
---

Fix the Event Signup form and its checkout/payment paths fataling with a white screen when fair-events-experimental lags behind fair-audience's expected pricing interface (e.g. a partial or delayed update). Group-discount pricing lookups now degrade gracefully to the base price and log a warning instead of crashing the page.
