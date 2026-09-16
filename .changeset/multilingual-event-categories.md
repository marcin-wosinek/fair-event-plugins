---
"fair-events": patch
---

Fix the Manage Event editor dropping selected categories from other Polylang languages on save. The category picker now loads every configured language and matches tokens by name and language together, so same-named categories in different languages no longer collide or disappear on an unrelated save.
