---
"fair-form": patch
---

Fix the Fair Form block's "Notification Email" so it fires on every submission, not just ones where the form collects the submitter's email address and the audience-tracking plugin is active. The notification now has its own mail path in fair-form and no longer depends on fair-audience being installed.

Note: the recipient is now resolved from the block's attributes in the page's own content. A Fair Form block placed outside a page/post's content — for example in a full-site-editing template or template part, a widget area, or a non-synced pattern used that way — will not receive notifications. Previously this worked because the recipient was carried on the rendered block markup. If you rely on a Fair Form block in a template or template part, move it into page/post content until this is addressed in a follow-up.
