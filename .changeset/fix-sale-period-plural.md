---
"fair-events": patch
---

Fix the Sale Periods summary always rendering "1 days before event" — the days-before label now uses `_n()` so the count picks the correct plural form.
