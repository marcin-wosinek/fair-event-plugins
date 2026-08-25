---
name: plan-ticket
description: Ground a Fair Event Plugins GitHub issue in the current codebase, resolve implementation decisions with the user, and post an approved implementation-plan comment.
---

# Plan a ticket

Read the issue and all discussion. Ground the proposal in the repository as it exists now: identify concrete paths, current patterns, constraints, and the closest sibling implementation. Read the applicable reference documents listed in `AGENTS.md` before drafting.

Structure the plan in implementable layers such as access/URL, frontend, backend, data, and tests. Re-check the ticket's open questions against the code, drop questions already resolved by current behavior, and add newly discovered forks. Recommend an option and explain the alternative for each real fork.

End the draft with `## Read first` and list the exact applicable repository reference docs. Present the full plan in chat and resolve every fork with the user. Do not post while any decision is unresolved or before explicit approval.

The approved GitHub comment must begin with `## Implementation plan`, contain resolved outcomes under `## Decisions`, and end with `## Read first`. Post it with a temporary body file, remove that file afterward, and do not add AI attribution.
