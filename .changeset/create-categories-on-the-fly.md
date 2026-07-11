---
"fair-events": minor
"fair-events-experimental": patch
---

Creating an unrecognized category in the Manage Event Categories field no longer silently drops it: unknown tokens now POST to a create-category endpoint and get linked once the term exists (issue #992). The endpoint moves from `fair-events-experimental` (behind the sources feature flag) to stable `fair-events`, since the base Manage Event page needs it regardless of which extensions are active.
