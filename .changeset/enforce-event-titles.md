---
"fair-events": patch
"fair-events-shared": patch
---

Reject empty/whitespace-only event titles in the quick-create button and the create/update REST endpoints (update never validated title at all), and show a shared "(untitled event)" fallback label everywhere a title is rendered so legacy untitled rows stay legible (issue #990).
