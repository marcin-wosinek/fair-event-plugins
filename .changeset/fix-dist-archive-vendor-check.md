---
"fair-timetable": patch
---

Fix the WordPress.org packaging/release workflow to fail instead of silently continuing when the production `composer install` fails, and add a pre-publish check that the built ZIP actually contains `vendor/autoload.php`. Previously a failed dependency install could still produce and ship a ZIP missing `vendor/`, causing a fatal error on activation.
