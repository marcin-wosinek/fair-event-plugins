---
'fair-events': minor
'fair-audience': minor
'fair-form': minor
'fair-timetable': minor
'fair-payments-connector': minor
'fair-calendar-button': minor
---

Each plugin now ships documentation of its blocks in `block-docs/`, matched
to the release: `index.json` lists every block the plugin supplies, with its
owning plugin, block.json, status, and when it is registered, and each block
has a usage guide and serialized examples that open in the editor without
validation errors. Site tooling and AI assistants can read these files from
the installed plugin and compare them with the blocks a site reports through
WordPress's authenticated `/wp/v2/block-types` endpoint.
