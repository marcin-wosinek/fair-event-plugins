---
"fair-events": patch
"fair-events-experimental": patch
"fair-audience": patch
---

Reduce the database queries issued when rendering or purchasing through the Event Signup form: the active sale period, the viewer's group memberships, and the event's discount rules are now resolved once per render/request and reused across every ticket tier and activity, instead of being re-resolved once per tier. Query count no longer scales with the number of ticket tiers; displayed and charged prices are unchanged.
