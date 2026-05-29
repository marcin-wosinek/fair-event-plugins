---
"fair-events": minor
---

Introduce a feature-flag registry (`FairEvents\Core\Features`) that splits the
plugin into bundles — `venues`, `sources`, `galleries`, `ticketing`,
`event-tools`, `migration` — defaulting **off** for a clean public install.
Define `FAIR_EVENTS_INTERNAL` (or a per-bundle `FAIR_EVENTS_FEATURE_*`
constant) in `wp-config.php` to opt back into the full build; otherwise toggle
bundles from the new **Settings → Features** tab. REST controllers, admin
pages, blocks, frontend rewrites, and manage-event tabs all consult the
registry, so disabled bundles register no routes and surface no UI.
