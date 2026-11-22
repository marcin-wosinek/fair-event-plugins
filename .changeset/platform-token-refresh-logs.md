---
'fair-platform': patch
---

Record successful Mollie token refreshes in Connection Logs: a site's Last Refresh now updates when its token is refreshed, on the connection that issued the credential only, and follows rotated tokens. Tracking starts with each site's next connection or reconnection; earlier log rows keep an empty Last Refresh. Connection Logs never store or show the token.
