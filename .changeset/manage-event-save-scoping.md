---
"fair-events": patch
---

Move Manage Event's single global "Save Changes" button into the Event Details and Tickets tabs it actually applies to, labeled by what each saves, with per-section dirty-state tracking, a beforeunload guard, and an inline "Title is required" message instead of a silently disabled button (issue #987).
