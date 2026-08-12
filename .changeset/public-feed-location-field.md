---
"fair-events": patch
---

Fix the public events feed: a standalone external-link event with no explicit attendance mode now carries `location: { mode: 'online', joining_url: ... }` instead of omitting the `location` field entirely.
