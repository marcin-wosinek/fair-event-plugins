---
description: Branch, format, commit the current changes, and open a PR
argument-hint: [optional branch-name or note]
---

Take whatever is currently changed in the working tree (staged, unstaged, or
untracked) and ship it as a PR. `$ARGUMENTS`, if given, is a hint for the
branch name and/or a note about what the change is for — otherwise infer both
from the diff.

## 1. Check state

Run `git status` and `git diff HEAD`. If there are no changes at all, stop and
say so.

## 2. Branch

If currently on `main` (or another shared/base branch), create a dedicated
topic branch off it: `git checkout -b <slug>` (short, kebab-case, descriptive
of the change — use `$ARGUMENTS` as a hint if provided). If already on a topic
branch, stay on it.

Never commit directly to `main`.

## 3. Format

Run `npm run format` in each affected plugin workspace (per
[CLAUDE.md](../../CLAUDE.md) — the PostToolUse hook formats files as they're
edited, but this catches anything touched outside the hook). If JS/CSS changed
and `build/` output is stale, run `npm run build` too. Re-check `git status`
after formatting in case it touched additional files.

## 4. Commit

Follow [COMMIT_GUIDE.md](../../COMMIT_GUIDE.md):

- Stage files explicitly (`git add path/...`) — never `git add -A` or
  `git add .`. Before staging, check for anything suspicious (secrets,
  `.env`, unrelated files) and leave it out.
- Imperative, ~50-char subject; body (if needed) explains **why**, wrapped
  ~72 chars.
- **No attribution** — no `Co-Authored-By: Claude` trailer, no "Generated
  with Claude Code" footer.
- If the change relates to a GitHub issue, add `Closes #NNN` or `Refs #NNN`
  on its own line — but only if you can point to a real, matching issue;
  never guess a number.

## 5. Push and open the PR

Push with `-u` and open the PR with `gh pr create`, following the PR
description rules in [COMMIT_GUIDE.md](../../COMMIT_GUIDE.md) (Summary, Notes
if relevant, Test plan checklist, no attribution footer). Write the body to a
temp file and pass `--body-file`, then remove the temp file.

Report the PR URL when done.
