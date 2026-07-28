---
"fair-form": patch
---

Fix the Fair Form block failing to assign a form id on plain-HTTP sites (common for self-hosted staging), where `crypto.randomUUID()` is unavailable outside a secure context. The block now falls back to `crypto.getRandomValues()` when generating its id.
