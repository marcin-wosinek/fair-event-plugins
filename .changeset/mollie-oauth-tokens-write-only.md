---
"fair-payments-connector": patch
---

Security: Mollie OAuth access and refresh tokens are no longer readable or writable through `/wp/v2/settings` (they were previously returned in full to any `manage_options` user despite a REST context scope that had no effect). Disconnecting from Mollie now goes through a dedicated `oauth/disconnect` endpoint instead of clearing the tokens via the settings REST route.
