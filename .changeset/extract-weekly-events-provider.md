---
"fair-events": patch
---

Extract the weekly event aggregation logic into a stable `FairEvents\Services\WeeklyEventsProvider`, so it can be reused by the upcoming fair-audience weekly digest without depending on the experimental plugin (issue #916).
