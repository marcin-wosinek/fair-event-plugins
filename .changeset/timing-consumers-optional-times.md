---
'fair-events': minor
'fair-audience': patch
'fair-audience-experimental': patch
'fair-payments-connector': patch
'fair-events-shared': patch
---

Event lists, session status and metadata now read event dates with optional times. A date without an end time stays current and upcoming through its end date and is past from the next day, in every events list view. A timed date missing its start time stays upcoming until it ends. JSON-LD and Open Graph show a bare date where a time is missing, and for all-day events, instead of a midnight timestamp. A whole-series pass bought on the start date of a date without a start time covers it. Scheduled mailings anchored to a time that is not set wait without a send time and are rescheduled when the time is set. Signup emails and the mailing event picker show only the date when there is no start time. Events imported from another Fair Events site keep their dates and optional times.
