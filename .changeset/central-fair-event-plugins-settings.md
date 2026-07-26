---
"fair-events": minor
"fair-audience": minor
"fair-payments-connector": minor
"fair-timetable": minor
"fair-form": minor
"fair-platform": minor
---

Move the "Bundled translations" toggle out of each plugin's own settings screen into a single shared **Settings → Fair Event Plugins** screen that lists one row per active plugin. Previously saved values keep working unchanged. fair-audience and fair-payments-connector lose their Features tab (bundled-translations was its only entry); fair-timetable loses its whole Settings page; fair-platform loses its Features submenu. fair-events keeps its Features tab for the Ticketing bundle. The experimental companion plugins (fair-events-experimental, fair-audience-experimental, fair-payments-connector-experimental) now always load their bundled translation files instead of waiting on a WordPress.org language pack that will never exist for them.
