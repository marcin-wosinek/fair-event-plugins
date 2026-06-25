---
"fair-events": patch
---

Fix three visual/functional regressions in the events-week block: use block palette colors for external events (not just internal ones); constrain event chips to their column width so they don't overflow; add a clipboard API fallback so the copy button works in browsers that block `navigator.clipboard` without HTTPS.
