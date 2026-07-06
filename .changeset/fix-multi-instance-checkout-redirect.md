---
"fair-audience": patch
---

Fix `create_multi_instance_signup()` paid response missing `success: true`, which left the buyer stranded on the event page instead of redirecting to checkout for `multiple_instances` ticket types.
