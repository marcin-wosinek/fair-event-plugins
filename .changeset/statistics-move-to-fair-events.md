---
"fair-events": minor
"fair-audience": minor
"fair-events-experimental": minor
---

Move event Statistics into Fair Events. The Statistics tab on Manage Event and the standalone Statistics page no longer need Fair Events Experimental, and the page explains when Fair Audience is missing. The statistics endpoint now lives at `/fair-events/v1/event-dates/{id}/statistics`; the former `/fair-audience/v1/...` path keeps working as an alias. Experimental's "Audience statistics" setting is retired.
