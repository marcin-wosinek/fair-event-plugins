---
'fair-finance': patch
---

Spreadsheet imports now read files with SheetJS 0.20.3, which fixes the
prototype-pollution and denial-of-service problems of the release used before.
Bank-entry imports (.xlsx, .xls) and Mollie settlement CSV matching give the
same results as before.

A file that cannot be read as a spreadsheet now shows "Failed to parse file."
instead of an internal error message, and an empty settlement file is reported
as empty. Choosing another file while an earlier one is still being matched no
longer lets the earlier result appear next to the new file's error.
