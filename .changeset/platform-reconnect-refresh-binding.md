---
'fair-platform': patch
---

Fix Last Refresh staying empty after a site reconnects to Mollie: when Mollie hands the reconnected site the same refresh token as before, the new connection now takes it over, so its refreshes are recorded. Connection Logs also stop showing "Profile created" on connections where no Mollie profile was created.
