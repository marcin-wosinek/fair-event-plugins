---
'fair-events': patch
---

Database upgrades now run each pending migration once, after every table is in place, whether they start from plugin activation or from the first page load after an update. If a table can't be created, the upgrade is no longer marked complete and is retried on the next page load.
