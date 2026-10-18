---
'fair-events-experimental': minor
---

The Meta Conversions API access token is now managed in Settings → Connectors. A token saved earlier keeps working without being entered again, and conversion delivery continues after upgrading. The Meta section of the Experimental settings shows whether a token is configured and links to Connectors; the dataset ID, Test Events code, test events and delivery diagnostics stay where they were. The token can also come from an environment variable or PHP constant named `FAIR_EVENTS_EXPERIMENTAL_META_ACCESS_TOKEN`, which take precedence over the saved one. Removing the token stops conversion delivery until another is saved. The Meta settings API no longer accepts an `access_token` and its token removal route is gone.
