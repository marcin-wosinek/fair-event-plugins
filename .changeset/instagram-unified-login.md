---
'fair-platform': minor
'fair-events-experimental': minor
'fair-audience-experimental': minor
'fair-audience': minor
---

Instagram connects through Meta's Unified Login. Fair Events → Instagram signs in with Facebook, and the administrator shares exactly one Instagram professional account. Only a single-use code returns to the site, and the site's server exchanges it for the access token, so the token never appears in a URL or the browser. The token does not expire and is no longer renewed. Publishing, the connection test and Fair Audience → Instagram Posts use graph.facebook.com. Every existing Instagram connection must be reconnected: until then it stays stored but is not used, and posts and their records are kept. Manual token entry and the account ID field are gone, and Fair Audience → Settings → Instagram now shows the connection's status and points to Fair Events → Instagram to connect. Fair Platform needs the `META_APP_ID`, `META_APP_SECRET` and `META_INSTAGRAM_CONFIG_ID` constants, refuses older clients with an update message, and answers the retired token renewal with 410. Cancelling at Meta is now reported as cancelled.
