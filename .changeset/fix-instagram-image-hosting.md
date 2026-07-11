---
"fair-audience-experimental": patch
---

Fix Instagram schedule-image posting failing with an unrecognized-format error after tmpfiles.org stopped serving raw image bytes. `upload_blob()` now stores the PNG directly as a WordPress attachment (tagged `_fair_audience_instagram_temp`, deleted after a successful publish) instead of round-tripping through the third-party host; a new hourly cron sweep cleans up anything left by an abandoned publish (issue #1063).
