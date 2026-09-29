---
"fair-events-experimental": minor
---

Removed the Migrate Posts to Events and Migration Summary admin pages, the "Migration" feature toggle, and their REST routes, including the orphan repair and deletion actions. Old bookmarks to these pages and a previously saved "Migration" setting no longer bring them back. Previously migrated events, their dates and relationships, and all other stored data stay as they are; Fair Events' own database upgrades are unaffected.
