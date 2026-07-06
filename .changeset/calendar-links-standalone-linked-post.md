---
"fair-events": patch
---

Fix recurring standalone occurrences linked to a post via "Link Existing Event" rendering as a plain unstyled span instead of a button link in the calendar block. `get_display_url()` now falls back to the junction-linked post's permalink, and the calendar renders a link whenever a URL is available, not just for external link type.
