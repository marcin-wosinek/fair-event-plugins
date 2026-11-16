---
'fair-platform': minor
---

Add a public health check for the Mollie OAuth proxy at `/wp-json/fair-platform/v1/health`. It answers `200` with `{"service":"fair-platform-oauth-proxy","status":"ok"}` when Fair Platform has started and its Mollie credentials and library are present. It answers `503` with `"status":"unhealthy"` otherwise, and has no route while the plugin is paused or inactive. It never contacts Mollie and never reveals configuration, and its answer is never cached. Deploys to fair-event-plugins.com now fail when the proxy isn't answering.
