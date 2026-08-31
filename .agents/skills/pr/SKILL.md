---
name: pr
description: Turn the current Fair Event Plugins working-tree changes into a formatted, verified commit on a topic branch and open a pull request. Use when asked to ship existing changes or open a PR.
---

# Open a PR from current changes

Inspect `git status` and `git diff HEAD`. If nothing changed, stop. Preserve unrelated user changes and never commit directly to `main`; create a short topic branch when currently on a shared branch.

Read `COMMIT_GUIDE.md`. Run the applicable Definition of Done checks from `AGENTS.md`, including formatting in each affected workspace and builds for changed JS/CSS. Re-inspect the tree after tools that may generate files.

Stage explicit paths only; never use `git add .` or `git add -A`. Exclude secrets, environment files, and unrelated changes. Use an imperative commit subject and add `Closes #N` or `Refs #N` only when a real matching issue is known.

Push and create the PR with a temporary body file. Include Summary and Test plan, plus Notes when relevant. Remove the temporary file, do not add AI attribution, and report the PR URL. Do not commit unless the request to ship the changes authorizes it.
