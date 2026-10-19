---
'fair-events': minor
'fair-audience': minor
---

Event notifications now keep one history for Telegram summaries, individual
emails and group emails. Each scheduled send and each test is recorded as an
execution with its outcome (success, partial success, failure, skipped or
unknown), the reason for a skip or failure, and counts of accepted, failed,
skipped and unknown deliveries. Each delivery names its recipient or chat,
when it was attempted and a safe reason code; an email is "accepted" once the
site's mail system took it, which does not confirm it reached the inbox. A
send that stops midway keeps the results it recorded and marks the rest
unknown. Names and destinations are kept as they were, so history stays
readable after a configuration is changed or removed.

Administrators can read the history through the REST API, for the whole
site or one configuration, filtered by configuration, channel, scheduled or
test, outcome and date, a page at a time. Earlier run records and delivery
records are imported once and marked as legacy, without adding details they
did not record. History is kept for 365 days.

Fair Audience reports each group email recipient as it sends. Fair Events
waits for this Fair Audience version before sending group emails, showing
the existing "update Fair Audience" notice until then.
