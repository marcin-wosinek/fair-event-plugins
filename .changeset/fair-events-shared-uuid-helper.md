---
"fair-events-shared": patch
---

Add a `generateUuid()` helper that falls back to `crypto.getRandomValues()` when `crypto.randomUUID()` is unavailable (plain-HTTP sites are not a secure context), for blocks that need to mint a stable id in the editor.
