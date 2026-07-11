---
"fair-audience": patch
---

Fix the "continue where you left off" email link landing on the failed-payment retry card instead of the resume form when the participant also had a stale `pending_payment` hold. The resume-token branch is now checked first, and the signup block auto-scrolls into view on restore.
