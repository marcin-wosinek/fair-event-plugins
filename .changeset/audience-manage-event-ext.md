---
"fair-audience": minor
"fair-audience-experimental": minor
---

Move the manage-event tab extensions (Audience, Groups, Mailings) out of `fair-audience` into the `fair-audience-experimental` companion under the `manage-event-ext` feature flag (issue #1041). The tab bundle's enqueue wiring on fair-events' manage-event page — previously always registered by `fair-audience` — now lives in the companion and only mounts when its `manage-event-ext` feature is enabled, mirroring how `fair-events-experimental` merges its own manage-event extensions.
