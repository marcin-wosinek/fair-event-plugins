---
'fair-events-experimental': minor
---

Add a Meta `FairEventCalendarClick` test to the Experimental settings, built like a real calendar click and sent to Test Events. Test results now show Meta's received-event count, messages, HTTP status and trace ID. Test sends and routine deliveries count as received only when Meta confirms receiving the event; an unconfirmed answer is retried.
