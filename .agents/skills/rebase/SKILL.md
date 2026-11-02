---
name: rebase
description: Rebase the current Fair Event Plugins topic branch onto origin/main and push it with --force-with-lease. Use when asked to rebase, update a branch from main, or refresh a PR branch.
---

# Rebase onto origin/main

Run `git status`. Stop if the working tree has uncommitted changes, a rebase/merge is already in progress, or `HEAD` is detached; report what was found instead of stashing or discarding anything. Stop if the current branch is `main`: never rebase or force-push `main`.

Run `git fetch origin`, then `git rebase origin/main`. If it reports nothing to do and the branch is already pushed, say so and stop.

On conflicts, inspect each conflicted file and resolve it by keeping the intent of both sides. Generated files (for example `build/`, `*.asset.php`, translation catalogs, `package-lock.json`) are regenerated instead of hand-merged: take `origin/main`'s version, continue, and rebuild them after the rebase in the affected workspace. Stage resolved paths explicitly and run `git rebase --continue` (with `GIT_EDITOR=true`). If a conflict's correct resolution is unclear, run `git rebase --abort`, and report the conflicting files and commits rather than guessing.

After the rebase, check `git log --oneline origin/main..HEAD` contains only the branch's own commits. When conflicts were resolved, rerun the relevant build, format and tests from the `AGENTS.md` Definition of Done before pushing, and commit any regenerated files. If the branch adds a migration, confirm its `Schema::DB_VERSION` number is still above `origin/main`'s.

Push with `git push --force-with-lease origin HEAD` (add `-u` if the branch has no upstream). Never use plain `--force`. If the lease is rejected, the remote branch moved: stop and report instead of overwriting it. Report the new head, the number of rebased commits, and any conflicts resolved.
