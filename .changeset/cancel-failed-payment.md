---
"fair-events": patch
---

"Cancel and start over" now works after an Event Signup payment has failed, was canceled or expired, including when the payment provider reports the failure after the payment card was shown. The visitor gets a fresh signup form instead of an error, and the previous attempt can no longer be resumed or retried. A payment that completes while the visitor cancels stays confirmed, including one that arrives just after the reservation was released. If the attempt cannot be released safely, nothing changes, the visitor sees an error on the same card and can try again.
