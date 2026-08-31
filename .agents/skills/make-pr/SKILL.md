---
name: make-pr
description: Implement a Fair Event Plugins GitHub issue or a specific issue comment on a topic branch, verify it, and open a pull request. Use for requests to implement or make a PR from a ticket.
---

# Implement a ticket and open a PR

Resolve the supplied issue number, issue URL, or issue-comment URL. For a comment URL, that exact comment is the spec and the rest of the issue is context. For a whole issue, prefer the latest comment whose first line is `## Implementation plan`; its `## Decisions` and `## Read first` sections are authoritative, while the issue body remains context. If no plan exists, use the issue body.

If the spec and current code diverge materially, or a scope/design decision remains unresolved, stop and ask. Record an agreed new decision as a timestamped `## Decision` issue comment rather than editing the plan.

Never work on `main`. Update `main`, create a short issue-suffixed topic branch, read every document in `## Read first`, and implement against current sibling patterns and `AGENTS.md`.

Before committing, satisfy the complete Definition of Done in `AGENTS.md`. Verify user-facing behavior in the running WordPress site. Add a changeset for user-visible changes according to `RELEASES.md`. For `responsive-ui` issues, capture the required before/after screenshots at all three viewports.

Follow `COMMIT_GUIDE.md`. Stage explicit paths, use an imperative commit subject, add `Closes #N` for a whole issue or `Refs #N` for partial comment-scoped work, and map every acceptance criterion to evidence in the PR body. Push and create the PR using a temporary body file. Do not add AI attribution. Report the PR URL and suggest an appropriate code review; suggest security review when the issue identifies security-sensitive surface.
