---
"fair-form": patch
---

Fix the Fair Form block's "Notification Email" so it fires on every submission, not just ones where the form collects the submitter's email address and the audience-tracking plugin is active. The notification now has its own mail path in fair-form and no longer depends on fair-audience being installed.
