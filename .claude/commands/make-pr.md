---
description: Implement a GitHub issue (or a specific comment on it) on a dedicated branch and open a PR
argument-hint: <issue-number | issue-url | comment-url>
---

Implement the work described by: $ARGUMENTS — then open a PR for it on a
dedicated branch.

## 1. Resolve the target

`$ARGUMENTS` is one of:

- a **bare issue number** (e.g. `123`) — implement the whole ticket;
- an **issue URL** — extract the number and implement the whole ticket;
- a **comment URL** (e.g. `…/issues/123#issuecomment-456`) — the work is
  scoped to **that specific comment**, not the whole ticket. Extract both the
  issue number and the comment id.

Read the issue and its discussion with `gh issue view <number> --comments`.
When the target is a comment, find that exact comment (match the
`#issuecomment-<id>` anchor — `gh api repos/{owner}/{repo}/issues/comments/<id>`
fetches it directly) and treat **its** content as the spec; use the rest of the
thread only as context. If anything about the scope is ambiguous, ask me before
writing code.

## 2. Branch

Never work on `main`. From an up-to-date `main`, create a dedicated topic
branch named for the work, e.g. `git checkout main && git pull` then
`git checkout -b <slug>-<issue-number>` (short, kebab-case, descriptive).

## 3. Implement

Ground the change in the real codebase: load the relevant CLAUDE.md reference
doc for the area (REST, React admin, blocks, i18n, testing) and mirror the
existing sibling pattern. Follow all Critical Rules in CLAUDE.md.

Before committing:

- Run `npm run format` in the affected plugin (catches files touched outside
  the format hook).
- Run `npm run build` in the affected plugin if you changed JS/CSS, so
  generated assets land.
- Run the relevant tests (`npm test`, `vendor/bin/phpcs`, etc.) and report
  results honestly.

## 4. Commit, push, open the PR

Follow [COMMIT_GUIDE.md](../../COMMIT_GUIDE.md):

- Imperative ~50-char subject; body explains **why**.
- **No attribution** — no `Co-Authored-By: Claude` trailer, no "Generated with
  Claude Code" footer in commit or PR.
- Put `Closes #<number>` on its own line at the bottom of the commit body, and
  also in the PR **Summary** so the link shows in the UI. Use `Refs #<number>`
  instead if the comment is only part of the larger ticket.

Push the branch and open the PR with `gh pr create`. Write the PR body to a
temp file and pass `--body-file` (then remove it). Report the PR URL when done.
