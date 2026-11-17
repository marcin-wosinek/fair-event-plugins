---
'fair-platform': minor
---

Report failures in the Mollie OAuth proxy's authorize, callback, profile selection and refresh flows to Sentry when `FAIR_PLATFORM_SENTRY_DSN` is set in `wp-config.php`. Reports carry only fixed categories, OAuth error codes, HTTP statuses and code locations: no tokens, codes, secrets, state values, request data or error messages. They are rate-limited and never change what the proxy answers.
