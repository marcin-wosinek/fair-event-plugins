---
"fair-audience": patch
---

Add test coverage for the weekly events digest (issue #916): PHPUnit tests for `WeeklyDigestRenderer` (config sanitizing, HTML shaping) and `WeeklyDigestHooks` (due/idempotency guard), a REST API spec for `WeeklyDigestController`, and a component test for the Weekly Digest admin page. Also adds a PHPUnit setup (`phpunit.xml`, `__tests__/bootstrap.php`) to fair-audience, mirroring fair-events.
