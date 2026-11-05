---
'fair-events': minor
---

Migrate historical payment history into Fair Events. A dry run reports what the migration would do; after reviewing it and confirming a database backup, an administrator starts the backfill, which runs in the background. It gives historical Fair Audience participants a matching ticket purchase, links past payment attempts to the purchases they paid for, lists every payment it can't attribute safely, and compares ticket counts and revenue per event date. Ticket counts, capacity, Statistics, payments and emails stay the same. The Payment history page for starting it and reviewing the results comes in a later release; until then, see the upgrade notes for the WP-CLI commands.
