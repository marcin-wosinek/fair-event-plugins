---
'fair-events-experimental': patch
---

Meta calendar and ticket button clicks, and the calendar click test, now
include the visitor's browser user agent as `client_user_agent`, so Meta
receives the browser details it expects with server events. The user agent is
used only for the send: it is never stored or shown in diagnostics. WordPress
now waits up to ten seconds, instead of three, for Meta to answer a click; the
visitor's button still never waits.
