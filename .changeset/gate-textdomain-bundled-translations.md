---
"fair-events": patch
"fair-payment": patch
"fair-audience": patch
"fair-platform": patch
"fair-timetable": patch
---

Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
`wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
feature flag (resolved through the same constant / master / filter / option /
default chain as the existing Fair Events features). The flag is exposed in
each plugin's Settings → Features tab (or Features submenu) and defaults to off.
