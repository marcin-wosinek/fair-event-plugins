---
name: reopen-ticket
description: Turn testing findings on an existing Fair Event Plugins implementation into a new corrective implementation plan, reopen the issue if closed, and return it to Ready after approval.
---

# Reopen a ticket after testing

Read `TICKETS.md`, the issue and all discussion, and the relevant implementation or linked PR. Treat the user's testing findings, screenshots, and reproduction steps as the starting evidence.

Inspect the current code and read the applicable reference documents listed in `AGENTS.md`. Distinguish observed behavior from inferred causes. Ask only for missing information that materially affects the correction.

Plan changes to the existing implementation. Identify what already works, the remaining discrepancy, concrete affected paths, and focused regression coverage. Do not repeat completed implementation work as new tasks.

Present the full proposed plan in chat, opening with the issue number, link, title, and a short summary of the testing findings. Resolve genuine decisions with the user, recommending an option for each fork.

The proposed comment must:

- Begin with `## Implementation plan`.
- State that it is a follow-up based on testing the existing implementation.
- Describe the findings, corrective changes, and verification.
- Record resolved outcomes under `## Decisions`.
- End with `## Read first`, listing exact applicable reference docs.

Before publishing, obtain explicit approval of the plan. Make clear that approval also authorizes reopening the issue if closed and returning its Project 5 Status to Ready. Existing explicit approval in the conversation remains valid.

After approval:

1. Post a new plan comment using a temporary body file. Preserve earlier plans and comments unchanged. Do not add AI attribution.
2. Reopen the GitHub issue if closed; leave an open issue open.
3. Set the ticket's project status to Ready following `TICKETS.md` § Project status transitions, including its explicit `reopen-ticket` exception. Check the current Status first, write only when needed, and read the item back to verify.
4. Read back the comment and issue state to verify.
5. Remove the temporary body file.

Do not alter the sprint or project-wide configuration. If the project item or Ready option is missing, report the exact remaining action.

On retry, find the follow-up comment for these testing findings and finish only incomplete steps. An older implementation plan is not this follow-up; do not edit it or mistake it for a duplicate. If a write errors, read back its state before retrying.

Report the new comment URL, issue reopening outcome, and verified project status separately.
