---
"fair-events-shared": minor
"fair-audience": minor
"fair-events": minor
---

Move fair-audience's signup confirmation email formatting into a shared `FairEventsShared\Notifications\SignupConfirmationEmail` formatter, and use it for both plugins' confirmation emails. fair-audience's confirmation email now also shows the event date, a registration reference, and the ticket type. fair-events' standalone confirmation email (sent when fair-audience isn't active) is now built from the same branded HTML template instead of a plain-text message, and includes the ticket type and — on paid signups — the amount paid.
