---
"fair-events": patch
---

Fix events-calendar/events-week block colors being silently ignored when the color picker returns a non-hex CSS value (e.g. `oklch(...)`, `rgb(...)`) instead of a preset slug or hex code — such values were wrongly treated as WordPress preset-color slugs, producing invalid CSS that browsers dropped.
