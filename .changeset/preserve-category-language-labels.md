---
"fair-events": patch
---

Fix the Manage Event editor showing multilingual categories without their language label after loading. The saved event's category records (which carry no language) could arrive after the all-languages options fetch and overwrite the language metadata already loaded, regardless of which request finished first.
