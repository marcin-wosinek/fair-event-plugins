---
"fair-audience": minor
---

Add the weekly events digest backend: a `fair_audience_weekly_digest` option, `WeeklyDigestController` REST routes (config, sources, preview, test-send), a shared `WeeklyDigestRenderer`, and a `WeeklyDigestHooks` cron with `last_sent_week` idempotency (issue #916). No admin UI yet — configuration is REST-only until the admin page lands.
