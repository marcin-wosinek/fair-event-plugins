---
'fair-events': major
'fair-events-shared': minor
'fair-audience': patch
'fair-audience-experimental': patch
'fair-events-experimental': patch
'fair-payments-connector': patch
'fair-finance': patch
---

Event dates are now stored and exchanged only as dates with optional start and end times. The `start_datetime` and `end_datetime` fields are gone from the `fair-events/v1/event-dates` API: requests that send them are rejected, and responses no longer include them. List sorting uses `orderby=start_date`. The public events feed sends `start` and `end` only for a time that is set (or the day boundaries of an all-day event), and `null` instead of an invented midnight. Events imported from another Fair Events site without a start time are no longer skipped. On upgrade, the old datetime columns are removed once every event date has been converted. Admin screens, emails and date labels across the plugins show a time only when one is set.
