---
"fair-events": patch
---

Apply the `fair_events_enabled_features_map` filter in the Gutenberg sidebar metabox localization, matching the Manage Event admin page. This was preventing extensions (e.g. fair-events-experimental) from enabling the venue-selection feature in the sidebar, which always rendered a plain address field instead of the venue dropdown.
