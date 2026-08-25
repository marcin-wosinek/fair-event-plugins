---
name: release
description: Add a Changesets release entry for one or more Fair Event Plugins workspaces without publishing or versioning packages.
---

# Add a changeset

Read `RELEASES.md` and the root `package.json`. Validate every requested package against the current `workspaces` array; never rely on a copied package list.

Use `patch` for fixes, `minor` for backward-compatible features, and `major` for breaking changes. If the bump was not explicit, infer a recommendation from the actual change and confirm it with the user before writing.

Create `.changeset/<short-kebab-summary>.md` with valid Changesets frontmatter and one concise, user-visible summary. Show the resulting file. Do not run versioning or publishing commands unless explicitly requested.
