---
"fair-audience": minor
"fair-audience-experimental": minor
"fair-events-experimental": patch
---

Move the groups and invitations bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `Group`/`GroupParticipant` and their repositories are renamed to `FairAudienceExperimental\…` and now travel with the companion; every core `fair-audience` call site (participant lists, custom mail, payment discount labels, signup pricing, anonymization, the signups-list block) and the `fair-events-experimental` invitation-token controller degrade gracefully via `class_exists()` guards when the companion is inactive.
