---
description: Add a Changeset for one or more plugins (drives the release flow in RELEASES.md)
argument-hint: <plugin> [patch|minor|major] [summary...]
---

Add a Changeset for the work described in: $ARGUMENTS

Releases in this repo are Changeset-driven (see RELEASES.md). The version bump
and git tag happen automatically once the changeset lands on `main` — CI opens a
version PR and tags on merge. Your only job is to create the changeset correctly.

Steps:

1. Resolve the target package name from the first argument. It MUST be one of the
   npm workspaces in the root `package.json` (currently: `fair-payment`,
   `fair-events`, `fair-audience`, `fair-platform`, `fair-events-shared`). If it
   isn't a real workspace, stop and ask me.
2. Decide the bump type from the second argument, or infer it from the staged /
   recent changes using RELEASES.md's rule (patch = fix, minor = backward-
   compatible feature, major = breaking) and confirm with me.
3. Write a new file `.changeset/<short-kebab-summary>.md`:

   ```md
   ---
   "<package>": <patch|minor|major>
   ---

   <one concise, user-visible summary of the change>
   ```

4. Show me the changeset file. Do NOT run `npm run version-packages` or
   `npm run release` unless I explicitly ask — committing the changeset to `main`
   is enough to trigger the release flow.
