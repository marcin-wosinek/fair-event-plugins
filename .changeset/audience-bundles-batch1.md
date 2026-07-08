---
"fair-audience": minor
"fair-audience-experimental": minor
---

Move the fees, polls, instagram, collaborators, image-templates, timeline, import, and weekly-schedule bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags. None of these bundles had callers outside fair-audience, so this is the lowest-risk slice of the fair-audience/fair-audience-experimental split (issue #1041). The `fair-audience` top-level admin menu now lands on All Participants instead of the (now-moved) Activity Timeline page.
