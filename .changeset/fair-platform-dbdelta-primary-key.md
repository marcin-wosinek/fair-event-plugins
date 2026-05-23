---
"fair-platform": patch
---

Fix database table creation on a clean install: declare the primary and secondary keys in dbDelta-compliant form (`PRIMARY KEY  (id)` / `KEY`) instead of inline on the column, which had caused "Multiple primary key defined" errors and a failed activation.
