---
"fair-events": patch
---

Fix untranslatable string concatenation on the Manage Event page. The linked-posts notice and the sale period label built sentences by concatenating separate `__()` fragments, which translators can't reorder for languages with different word order; both now use `_n()` and `sprintf()` for proper pluralization and ordering.
