---
name: new-plugin
description: Scaffold a new plugin in the Fair Event Plugins monorepo and update all required workspace, CI, deployment, compose, version-sync, and changelog integration points.
---

# Add a plugin

Read `ADDING_NEW_PLUGIN.md` first and treat the root `package.json` plus current repository files as authoritative. Choose the smallest current plugin that matches the requested capabilities as the structural reference; do not copy stale file lists or workflow names from historical instructions.

Draft and show a concrete plan before creating files. Include plugin structure, namespace/slug mapping, root workspace scripts, CI cache, applicable deployment workflow, both WordPress and WP-CLI compose mounts, version/changelog sync configuration, build and test setup, and an initial changeset.

After approval, implement the plan and run the applicable Definition of Done checks in `AGENTS.md`. Confirm generated maps/assets come from the build and are not hand-edited.
