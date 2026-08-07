---
description: Draft a GitHub issue (behaviour + risks, no code references), confirm it, and file it into a sprint project
argument-hint: [current|next] <what the ticket is about>
---

Write a GitHub issue for: $ARGUMENTS

The first word of $ARGUMENTS, if it is `current` or `next`, is the sprint —
not part of the ticket topic.

Follow [TICKETS.md](../../TICKETS.md). The essentials:

1. **Understand the behaviour — don't cite the code.** Explore the codebase as
   much as needed to describe current behaviour and what should change, but the
   ticket body must contain **no direct code references** (no file paths, class
   names, function names, route strings). Tickets often sit a sprint or more
   before planning and the surrounding code changes underneath them — stale
   references mislead. Naming the plugin and existing *features* ("the gallery
   download flow") is fine. Code grounding happens later, at `/plan-ticket`
   time.

2. **Draft the ticket** using the TICKETS.md skeleton: Plugin, Summary,
   Motivation, Expected behaviour, Risks, Open questions (real forks with a
   recommendation), Acceptance criteria as a `- [ ]` behaviour-level checklist.
   Linking reference docs (REST_API_BACKEND.md, TESTING.md, …) is fine — they
   are stable; code isn't. If the behaviour splits into independently
   shippable stages, propose separate tickets instead of one big one.

3. **Pick the sprint.** Tickets go into the current sprint or the next one, as
   items in the **Fair Event Plugins** GitHub Project (project 5, owned by
   `marcin-wosinek`) — not a milestone. Use $ARGUMENTS' leading `current`/`next`
   if present; otherwise ask me together with the draft review.
   - Current sprint view: https://github.com/users/marcin-wosinek/projects/5/views/1
   - Next sprint view: https://github.com/users/marcin-wosinek/projects/5/views/2
   - Sprints are the project's `Iteration` field (named `YYYY.W<week>`).
     Resolve which iteration is current/next by comparing today
     (`date +%F`) against each iteration's `startDate`/`duration`:
     ```
     gh api graphql -f query='query { user(login: "marcin-wosinek") { projectV2(number: 5) { fields(first: 20) { nodes { ... on ProjectV2IterationField { id configuration { iterations { id title startDate duration } } } } } } } }'
     ```

4. **Check it with me.** Show the full draft (title, body, target sprint, any
   label) in chat and pause. Do **not** create the issue until I approve.
   Incorporate feedback and re-confirm if anything changed.

5. **Create the issue and add it to the sprint.** Write the body to a temp
   file, create the issue, then add it to the project and set its Iteration
   field:
   ```
   gh issue create --title "…" --body-file /tmp/ticket.md
   ITEM_ID=$(gh project item-add 5 --owner marcin-wosinek --url "<issue-url>" --format json --jq '.id')
   gh project item-edit --id "$ITEM_ID" \
     --project-id PVT_kwHOAA-jmM4Bfe4P \
     --field-id PVTIF_lAHOAA-jmM4Bfe4PzhZxd2o \
     --iteration-id "<resolved-iteration-id>"
   ```
   then `rm -f /tmp/ticket.md`. Labels: only if one genuinely fits
   (`gh label list` first); leave unlabeled rather than forcing one. Apply
   `responsive-ui` whenever the expected behaviour changes layout across
   viewports — it's what gates the before/after screenshot requirement at
   `/make-pr` time (COMMIT_GUIDE.md). No Claude attribution anywhere. Report
   the issue URL.
